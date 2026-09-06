/**
 * Soft-delete ("trash") for projects.
 *
 * A soft-deleted project keeps its directory intact under `projects/{id}/`
 * with an added marker file `.openpost-trashed.json`. The marker is the
 * source of truth: its presence hides the project from listings. Permanent
 * deletion calls `deleteProject` after media cleanup.
 *
 * Ported from FreeCut (MIT) — workspace-fs/trash.ts.
 */

import { createLogger } from './logger';
import { requireWorkspaceRoot } from './root';
import {
	exists,
	listDirectory,
	readJson,
	removeEntry,
	writeJsonAtomic,
	WorkspaceFileCorruptError
} from './fs-primitives';
import {
	PROJECTS_DIR,
	projectJsonPath,
	projectMediaLinksPath,
	projectTrashedMarkerPath
} from './paths';
import { writeWorkspaceIndex, type WorkspaceIndexEntry } from './workspace-index';
import { withKeyLock } from './with-key-lock';

const logger = createLogger('WorkspaceFS:Trash');

/** Default TTL for auto-purge: 30 days. */
export const DEFAULT_TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Lock key shared with projects.refreshIndex so trash ops don't race with it. */
const INDEX_LOCK_KEY = 'projects:index';

function projectTrashLockKey(id: string): string {
	return `project-trash:${id}`;
}

export function withProjectTrashLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
	return withKeyLock(projectTrashLockKey(id), operation);
}

export type TrashMarker = {
	/** ms since epoch when the project was soft-deleted. */
	deletedAt: number;
	originalName: string;
};

export interface TrashedProjectEntry {
	id: string;
	marker: TrashMarker;
}

async function readMarker(
	root: FileSystemDirectoryHandle,
	id: string
): Promise<TrashMarker | null> {
	return readJson<TrashMarker>(root, projectTrashedMarkerPath(id));
}

async function markerExists(root: FileSystemDirectoryHandle, id: string): Promise<boolean> {
	return exists(root, projectTrashedMarkerPath(id));
}

async function rebuildAndWriteIndex(root: FileSystemDirectoryHandle): Promise<void> {
	const entries = await listDirectory(root, [PROJECTS_DIR]);
	const indexEntries: WorkspaceIndexEntry[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'directory') continue;
		if (await markerExists(root, entry.name)) continue;
		let project: { id: string; name: string; updatedAt: number } | null = null;
		try {
			project = await readJson<{ id: string; name: string; updatedAt: number }>(
				root,
				projectJsonPath(entry.name)
			);
		} catch (error) {
			if (!(error instanceof WorkspaceFileCorruptError)) throw error;
			logger.warn(`rebuildAndWriteIndex: skipping corrupt project.json for ${entry.name}`, error);
			continue;
		}
		if (!project) continue;
		indexEntries.push({
			id: project.id,
			name: project.name,
			updatedAt: project.updatedAt
		});
	}
	await writeWorkspaceIndex(root, indexEntries);
}

/**
 * Soft-delete a project. Idempotent — re-trashing returns the original marker.
 */
export async function softDeleteProject(id: string): Promise<TrashMarker> {
	return withProjectTrashLock(id, async () => {
		const root = requireWorkspaceRoot();
		const project = await readJson<{ name?: string }>(root, projectJsonPath(id));
		if (!project) {
			throw new Error(`Project not found: ${id}`);
		}

		const existingMarker = await readMarker(root, id);
		if (existingMarker) return existingMarker;

		const marker: TrashMarker = {
			deletedAt: Date.now(),
			originalName: project.name ?? id
		};

		await writeJsonAtomic(root, projectTrashedMarkerPath(id), marker);
		await withKeyLock(INDEX_LOCK_KEY, () => rebuildAndWriteIndex(root));
		logger.info(`Soft-deleted project ${id} ("${marker.originalName}")`);
		return marker;
	});
}

/**
 * Restore a trashed project by removing its marker and refreshing the index.
 * Throws if the project directory no longer exists.
 */
export async function restoreProject(id: string): Promise<void> {
	await withProjectTrashLock(id, async () => {
		const root = requireWorkspaceRoot();
		const project = await readJson<{ id: string }>(root, projectJsonPath(id));
		if (!project) {
			throw new Error(`Project not found (may have been purged): ${id}`);
		}

		if (!(await markerExists(root, id))) return;

		await removeEntry(root, projectTrashedMarkerPath(id));
		await withKeyLock(INDEX_LOCK_KEY, () => rebuildAndWriteIndex(root));
		logger.info(`Restored project ${id}`);
	});
}

export async function isProjectTrashed(id: string): Promise<boolean> {
	const root = requireWorkspaceRoot();
	return markerExists(root, id);
}

export async function listTrashedProjects(): Promise<TrashedProjectEntry[]> {
	const root = requireWorkspaceRoot();
	const entries = await listDirectory(root, [PROJECTS_DIR]);
	const trashed: TrashedProjectEntry[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'directory') continue;
		let marker: TrashMarker | null = null;
		try {
			marker = await readMarker(root, entry.name);
		} catch (error) {
			if (!(error instanceof WorkspaceFileCorruptError)) throw error;
			// A corrupt marker must not make the project invisible everywhere —
			// SAFETY: the stored value satisfies the target type here.
			// treat it as freshly trashed so the sweep doesn't auto-purge it.
			logger.warn(
				`listTrashedProjects: corrupt marker for ${entry.name}, using fallback entry`,
				error
			);
			trashed.push({
				id: entry.name,
				marker: { deletedAt: Date.now(), originalName: entry.name }
			});
			continue;
		}
		if (marker) {
			trashed.push({ id: entry.name, marker });
		}
	}
	trashed.sort((a, b) => b.marker.deletedAt - a.marker.deletedAt);
	return trashed;
}

export async function getTrashedProjectMediaIds(id: string): Promise<string[]> {
	const root = requireWorkspaceRoot();
	if (!(await markerExists(root, id))) {
		return [];
	}
	const links = await readJson<{ mediaIds?: Array<{ id: string }> }>(
		root,
		projectMediaLinksPath(id)
	);
	return links?.mediaIds?.map((m) => m.id) ?? [];
}

/**
 * Auto-purge trashed projects older than `ttlMs` via a caller-supplied purge
 * callback (media cleanup + deleteProject). Per-id errors don't stop the sweep.
 */
export async function sweepTrashOlderThan(
	ttlMs: number,
	onPurge: (id: string) => Promise<void>
): Promise<string[]> {
	const cutoff = Date.now() - ttlMs;
	const trashed = await listTrashedProjects();
	const expired = trashed.filter((e) => e.marker.deletedAt < cutoff);
	const purged: string[] = [];
	for (const entry of expired) {
		try {
			await onPurge(entry.id);
			purged.push(entry.id);
		} catch (error) {
			logger.warn(`sweepTrashOlderThan: onPurge(${entry.id}) failed`, error);
		}
	}
	if (purged.length > 0) {
		logger.info(`Auto-purged ${purged.length} expired trashed project(s) (TTL=${ttlMs}ms)`);
	}
	return purged;
}
