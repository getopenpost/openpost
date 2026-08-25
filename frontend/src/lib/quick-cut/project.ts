import {
	readJson,
	writeJsonAtomic,
	removeEntry
} from '$lib/video-editor/workspace-fs/fs-primitives';
import { requireWorkspaceRoot, getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { quickCutProjectPath } from './paths';
import type { QuickCutProject } from './types';

export function createNewProject(
	sourceFileName: string,
	duration: number,
	sourceSize?: number,
	sourceMime?: string
): QuickCutProject {
	const now = Date.now();
	return {
		version: 1,
		id: crypto.randomUUID(),
		name: sourceFileName.replace(/\.[^.]+$/, '') || 'Quick Cut',
		sourceFileName,
		sourceFileSize: sourceSize,
		sourceMimeType: sourceMime,
		duration,
		segments: [],
		cutMode: 'nearestKeyframe',
		merge: false,
		createdAt: now,
		updatedAt: now
	};
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
		return await readJson<QuickCutProject>(root, quickCutProjectPath(id));
	} catch {
		return null;
	}
}

export async function deleteProjectFromWorkspace(id: string): Promise<void> {
	const root = requireWorkspaceRoot();
	await removeEntry(root, quickCutProjectPath(id));
}

export function serializeProject(project: QuickCutProject): string {
	return JSON.stringify(project, null, '\t');
}

export function deserializeProject(json: string): QuickCutProject {
	const parsed = JSON.parse(json);
	if (parsed.version !== 1) throw new Error('Unsupported project version.');
	if (!Array.isArray(parsed.segments)) throw new Error('Invalid project: missing segments.');
	return parsed as QuickCutProject;
}

export function projectFileName(project: QuickCutProject): string {
	const safe = (project.name || 'quick-cut').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 32);
	return `${safe}-${project.id.slice(0, 8)}.llc.json`;
}
