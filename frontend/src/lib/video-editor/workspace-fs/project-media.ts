/**
 * Project ↔ media associations backed by the workspace folder.
 *
 * Forward associations per project are stored as:
 *   `projects/{projectId}/media-links.json` → { version, mediaIds: [{id, addedAt}] }
 *
 * Reverse lookups scan every project's media-links.json (fast at O(10–100)
 * projects). `getMediaForProject` repairs drift: backfills timeline
 * references missing from links and prunes associations whose metadata is gone.
 *
 * Ported from FreeCut (MIT) — workspace-fs/project-media.ts.
 */

import type { Project } from '../project/types';
import type { MediaMetadata } from '../media/types';
import { createLogger } from './logger';

import { requireWorkspaceRoot } from './root';
import { listDirectory, readJson, writeJsonAtomic } from './fs-primitives';
import { PROJECTS_DIR, projectMediaLinksPath } from './paths';
import { getProject } from './projects';
import { getMedia } from './media';
import { withKeyLock } from './with-key-lock';

function linksLockKey(projectId: string): string {
	return `project-media-links:${projectId}`;
}

const logger = createLogger('WorkspaceFS:ProjectMedia');

const METADATA_READ_CONCURRENCY = 8;

const mediaForProjectInFlight = new Map<string, Promise<MediaMetadata[]>>();

type ProjectMediaReadResult =
	| { kind: 'ok'; media: MediaMetadata }
	| { kind: 'missing'; mediaId: string }
	| { kind: 'error'; error: unknown };

const PROJECT_MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image']);

const LINKS_VERSION = '1.0';

interface LinkEntry {
	id: string;
	addedAt: number;
}

type ProjectMediaLinks = {
	version: string;
	mediaIds: LinkEntry[];
};

async function readLinks(
	root: FileSystemDirectoryHandle,
	projectId: string
): Promise<ProjectMediaLinks> {
	const existing = await readJson<ProjectMediaLinks>(root, projectMediaLinksPath(projectId));
	if (existing && Array.isArray(existing.mediaIds)) return existing;
	return { version: LINKS_VERSION, mediaIds: [] };
}

async function writeLinks(
	root: FileSystemDirectoryHandle,
	projectId: string,
	links: ProjectMediaLinks
): Promise<void> {
	await writeJsonAtomic(root, projectMediaLinksPath(projectId), links);
}

export function collectProjectTimelineMediaIds(
	project: Pick<Project, 'fontAssets' | 'timeline'> | null | undefined
): string[] {
	if (!project) return [];
	const mediaIds = new Set<string>();
	for (const asset of project.fontAssets ?? []) mediaIds.add(asset.id);
	if (!project.timeline) return [...mediaIds];
	for (const item of project.timeline.items) {
		if (item.mediaId && PROJECT_MEDIA_ITEM_TYPES.has(item.type)) {
			mediaIds.add(item.mediaId);
		}
		if (item.fontAssetId) mediaIds.add(item.fontAssetId);
		for (const span of item.textSpans ?? []) {
			if (span.fontAssetId) mediaIds.add(span.fontAssetId);
		}
	}
	for (const composition of project.timeline.compositions ?? []) {
		for (const item of composition.items) {
			if (item.mediaId && PROJECT_MEDIA_ITEM_TYPES.has(item.type)) {
				mediaIds.add(item.mediaId);
			}
			if (item.fontAssetId) mediaIds.add(item.fontAssetId);
			for (const span of item.textSpans ?? []) {
				if (span.fontAssetId) mediaIds.add(span.fontAssetId);
			}
		}
	}
	return [...mediaIds];
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function associateMediaWithProject(projectId: string, mediaId: string): Promise<void> {
	const root = requireWorkspaceRoot();
	try {
		await withKeyLock(linksLockKey(projectId), async () => {
			const links = await readLinks(root, projectId);
			if (!links.mediaIds.some((entry) => entry.id === mediaId)) {
				links.mediaIds.push({ id: mediaId, addedAt: Date.now() });
				await writeLinks(root, projectId, links);
			}
		});
	} catch (error) {
		logger.error(`associateMediaWithProject(${projectId}, ${mediaId}) failed`, error);
		throw error;
	}
}

export async function removeMediaFromProject(projectId: string, mediaId: string): Promise<void> {
	const root = requireWorkspaceRoot();
	try {
		await withKeyLock(linksLockKey(projectId), async () => {
			const links = await readLinks(root, projectId);
			const next = links.mediaIds.filter((entry) => entry.id !== mediaId);
			if (next.length !== links.mediaIds.length) {
				await writeLinks(root, projectId, { version: LINKS_VERSION, mediaIds: next });
			}
		});
	} catch (error) {
		logger.error(`removeMediaFromProject(${projectId}, ${mediaId}) failed`, error);
		throw error;
	}
}

export async function removeMediaBatchFromProject(
	projectId: string,
	mediaIds: string[]
): Promise<void> {
	const root = requireWorkspaceRoot();
	const targetIds = new Set(mediaIds.filter(Boolean));
	if (targetIds.size === 0) {
		return;
	}

	try {
		await withKeyLock(linksLockKey(projectId), async () => {
			const links = await readLinks(root, projectId);
			const next = links.mediaIds.filter((entry) => !targetIds.has(entry.id));
			if (next.length !== links.mediaIds.length) {
				await writeLinks(root, projectId, { version: LINKS_VERSION, mediaIds: next });
			}
		});
	} catch (error) {
		logger.error(`removeMediaBatchFromProject(${projectId}) failed`, error);
		throw error;
	}
}

export async function getProjectMediaIds(projectId: string): Promise<string[]> {
	const root = requireWorkspaceRoot();
	try {
		const links = await readLinks(root, projectId);
		return links.mediaIds.map((entry) => entry.id);
	} catch (error) {
		logger.error(`getProjectMediaIds(${projectId}) failed`, error);
		throw new Error(`Failed to get project media: ${projectId}`);
	}
}

/**
 // SAFETY: the stored value satisfies the target type here.
 * Trashed projects DO count as references on purpose: a restored project must
 * find its media. Space reclamation happens when the trash is emptied.
 */
export async function getProjectsUsingMedia(mediaId: string): Promise<string[]> {
	const root = requireWorkspaceRoot();
	try {
		const projectDirs = await listDirectory(root, [PROJECTS_DIR]);
		const result: string[] = [];
		for (const entry of projectDirs) {
			if (entry.kind !== 'directory') continue;
			const links = await readLinks(root, entry.name);
			if (links.mediaIds.some((link) => link.id === mediaId)) {
				result.push(entry.name);
			}
		}
		return result;
	} catch (error) {
		logger.error(`getProjectsUsingMedia(${mediaId}) failed`, error);
		throw new Error(`Failed to get projects for media: ${mediaId}`);
	}
}

async function loadMediaForProject(projectId: string): Promise<MediaMetadata[]> {
	requireWorkspaceRoot();
	try {
		const existingIds = await getProjectMediaIds(projectId);
		const project = await getProject(projectId);
		const referenced = collectProjectTimelineMediaIds(project);

		const associated = new Set(existingIds);
		const missing = referenced.filter((id) => !associated.has(id));

		for (const mediaId of missing) {
			const media = await getMedia(mediaId);
			if (!media) continue;
			await associateMediaWithProject(projectId, mediaId);
			associated.add(mediaId);
		}

		if (missing.length > 0) {
			logger.info(
				`Recovered ${missing.length} missing media association(s) for project ${projectId}`
			);
		}

		const finalIds = [...associated];
		function mapWithConcurrency<T, R>(
			items: T[],
			concurrency: number,
			fn: (item: T) => Promise<R>
		): Promise<R[]> {
			const results = new Array<R>(items.length);
			let nextIndex = 0;
			async function worker(): Promise<void> {
				while (nextIndex < items.length) {
					const index = nextIndex++;
					// SAFETY: the while condition guarantees index < items.length.
					results[index] = await fn(items[index] as T);
				}
			}
			return Promise.all(
				Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
			).then(() => results);
		}

		const loaded = await mapWithConcurrency(
			finalIds,
			METADATA_READ_CONCURRENCY,
			async (mediaId): Promise<ProjectMediaReadResult> => {
				try {
					const media = await getMedia(mediaId);
					return media ? { kind: 'ok', media } : { kind: 'missing', mediaId };
				} catch (error) {
					return { kind: 'error', error };
				}
			}
		);
		const media: MediaMetadata[] = [];
		const orphans: string[] = [];
		for (const result of loaded) {
			if (!result) throw new Error(`Metadata read produced no result for project ${projectId}`);
			if (result.kind === 'error') throw result.error;
			if (result.kind === 'ok') media.push(result.media);
			else orphans.push(result.mediaId);
		}

		if (orphans.length > 0) {
			logger.warn(`Cleaning up ${orphans.length} orphaned associations for project ${projectId}`);
			for (const orphanId of orphans) {
				await removeMediaFromProject(projectId, orphanId);
			}
		}

		return media;
	} catch (error) {
		logger.error(`getMediaForProject(${projectId}) failed`, error);
		throw new Error(`Failed to load project media: ${projectId}`);
	}
}

/** Deduplicated concurrent loader — editor startup asks more than once. */
export function getMediaForProject(projectId: string): Promise<MediaMetadata[]> {
	const existing = mediaForProjectInFlight.get(projectId);
	if (existing) return existing;

	const load = loadMediaForProject(projectId);
	mediaForProjectInFlight.set(projectId, load);
	const clear = () => {
		if (mediaForProjectInFlight.get(projectId) === load) {
			mediaForProjectInFlight.delete(projectId);
		}
	};
	void load.then(clear, clear);
	return load;
}
