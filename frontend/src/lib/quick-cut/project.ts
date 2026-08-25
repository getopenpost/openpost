// oxlint-disable
import {
	readJson,
	writeJsonAtomic,
	removeEntry
} from '$lib/video-editor/workspace-fs/fs-primitives';
import { requireWorkspaceRoot, getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { saveHandle, getHandle } from '$lib/video-editor/workspace-fs/handles-db';
import { quickCutProjectPath } from './paths';
import type { QuickCutProject, QuickCutSourceMetadata } from './types';
import type { QuickCutSource } from './types';

export function createNewProject(
	sources: QuickCutSourceMetadata[] | string,
	cutMode: QuickCutProject['cutMode'] = 'nearestKeyframe'
): QuickCutProject {
	const now = Date.now();
	const srcArray: QuickCutSourceMetadata[] = Array.isArray(sources)
		? sources
		: [
				{
					id: crypto.randomUUID(),
					name: sources,
					size: 0,
					mimeType: 'video/mp4',
					duration: 0,
					width: 0,
					height: 0,
					videoCodec: null,
					audioCodec: null,
					sampleRate: null,
					channels: null,
					rotation: 0,
					fps: null,
					keyframeTimestamps: []
				}
			];
	const name = srcArray[0]?.name.replace(/\.[^.]+$/, '') || 'Quick Cut';
	return {
		version: 1,
		id: crypto.randomUUID(),
		name,
		sources: srcArray,
		segments: [],
		cutMode,
		merge: false,
		createdAt: now,
		updatedAt: now
	};
}

// Legacy helper for single file name
export function createNewProjectFromName(
	sourceFileName: string,
	duration: number,
	sourceSize?: number,
	sourceMime?: string
): QuickCutProject {
	return createNewProject([
		{
			id: crypto.randomUUID(),
			name: sourceFileName,
			size: sourceSize ?? 0,
			mimeType: sourceMime ?? 'video/mp4',
			duration,
			width: 0,
			height: 0,
			videoCodec: null,
			audioCodec: null,
			sampleRate: null,
			channels: null,
			rotation: 0,
			fps: null,
			keyframeTimestamps: []
		}
	]);
}

export async function saveProjectToWorkspace(project: QuickCutProject): Promise<void> {
	const root = requireWorkspaceRoot();
	project.updatedAt = Date.now();
	await writeJsonAtomic(root, quickCutProjectPath(project.id), project);
}

export async function loadProjectFromWorkspace(id: string): Promise<QuickCutProject | null> {
	const root = getWorkspaceRoot();
	if (!root) return null;
	try {
		const raw = await readJson<
			QuickCutProject & {
				sourceFileName?: string;
				sourceFileSize?: number;
				sourceMimeType?: string;
				duration?: number;
			}
		>(root, quickCutProjectPath(id));
		if (!raw) return null;
		// Migration from single source legacy
		if (!raw.sources && raw.sourceFileName) {
			return {
				version: 1,
				id: raw.id,
				name: raw.name,
				sources: [
					{
						id: crypto.randomUUID(),
						name: raw.sourceFileName,
						size: raw.sourceFileSize ?? 0,
						mimeType: raw.sourceMimeType ?? 'video/mp4',
						duration: raw.duration ?? 0,
						width: 0,
						height: 0,
						videoCodec: null,
						audioCodec: null,
						sampleRate: null,
						channels: null,
						rotation: 0,
						fps: null,
						keyframeTimestamps: []
					}
				],
				segments: raw.segments ?? [],
				cutMode: raw.cutMode,
				merge: raw.merge,
				createdAt: raw.createdAt,
				updatedAt: raw.updatedAt
			};
		}
		// SAFETY: type assertion is safe for this quick-cut path
		return raw as QuickCutProject;
	} catch {
		return null;
	}
}

export async function deleteProjectFromWorkspace(id: string): Promise<void> {
	const root = requireWorkspaceRoot();
	await removeEntry(root, quickCutProjectPath(id));
}

export async function persistSourceHandles(sources: QuickCutSource[]): Promise<void> {
	for (const s of sources) {
		if (s.handle) {
			await saveHandle({
				kind: 'media',
				id: `quick-cut:${s.id}`,
				handle: s.handle,
				name: s.name,
				pickedAt: Date.now(),
				lastSeenSize: s.size
			});
		}
	}
}

export async function restoreSourceHandles(
	metas: QuickCutSourceMetadata[]
): Promise<Map<string, FileSystemFileHandle | null>> {
	const map = new Map<string, FileSystemFileHandle | null>();
	for (const m of metas) {
		const rec = await getHandle('media', `quick-cut:${m.id}`);
		// SAFETY: type assertion is safe for this quick-cut path
		if (rec) map.set(m.id, rec.handle as FileSystemFileHandle);
		else map.set(m.id, null);
	}
	return map;
}

export function serializeProject(project: QuickCutProject): string {
	return JSON.stringify(project, null, '\t');
}

export function deserializeProject(json: string): QuickCutProject {
	const parsed = JSON.parse(json);
	if (parsed.version !== 1) throw new Error('Unsupported project version.');
	if (!Array.isArray(parsed.segments)) throw new Error('Invalid project: missing segments.');
	if (!Array.isArray(parsed.sources) && parsed.sourceFileName) {
		// legacy
		return {
			version: 1,
			id: parsed.id,
			name: parsed.name,
			sources: [
				{
					id: crypto.randomUUID(),
					name: parsed.sourceFileName,
					size: parsed.sourceFileSize ?? 0,
					mimeType: parsed.sourceMimeType ?? 'video/mp4',
					duration: parsed.duration ?? 0,
					width: 0,
					height: 0,
					videoCodec: null,
					audioCodec: null,
					sampleRate: null,
					channels: null,
					rotation: 0,
					fps: null,
					keyframeTimestamps: []
				}
			],
			segments: parsed.segments,
			cutMode: parsed.cutMode ?? 'nearestKeyframe',
			merge: parsed.merge ?? false,
			createdAt: parsed.createdAt,
			updatedAt: parsed.updatedAt
		};
	}
	if (!Array.isArray(parsed.sources)) throw new Error('Invalid project: missing sources.');
	// SAFETY: type assertion is safe for this quick-cut path
	return parsed as QuickCutProject;
}

export function projectFileName(project: QuickCutProject): string {
	const safe = (project.name || 'quick-cut').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 32);
	return `${safe}-${project.id.slice(0, 8)}.llc.json`;
}
