/**
 * Projects store backed by the workspace folder.
 *
 * Each project lives at `projects/{id}/project.json` with an entry in
 * `index.json`. The non-serializable `rootFolderHandle` is stripped on write
 * and re-attached on read via the handles registry.
 *
 * Ported from FreeCut (MIT) — workspace-fs/projects.ts.
 */

import type { Project } from '../project/types';
import { migrateProjectDocument } from '../project/defaults';
import { ensureProjectUpgradeBackup as ensureProjectUpgradeBackupTransaction } from '../project/project-upgrade';
import { createLogger } from './logger';
import { deleteHandle, getHandle, saveHandle } from './handles-db';
import { requireWorkspaceRoot } from './root';
import {
	exists,
	listDirectory,
	readBlob,
	readJson,
	removeEntry,
	writeBlob,
	writeJsonAtomic,
	WorkspaceFileCorruptError
} from './fs-primitives';
import {
	PROJECTS_DIR,
	projectDir,
	projectJsonPath,
	projectMediaLinksPath,
	projectThumbnailPath,
	projectTrashedMarkerPath
} from './paths';
import {
	readWorkspaceIndex,
	sortIndexEntries,
	writeWorkspaceIndex,
	type WorkspaceIndexEntry
} from './workspace-index';
import { withKeyLock } from './with-key-lock';

/**
 * Single key for every `index.json` mutation — serializes concurrent creates
 * so the rebuilt index can't drop another caller's entry.
 */
const INDEX_LOCK_KEY = 'projects:index';

const logger = createLogger('WorkspaceFS:Projects');

/** Shape stored in project.json — no FileSystem*Handle fields. */
type SerializedProject = Omit<Project, 'rootFolderHandle'>;
type ProjectLoadIntent = 'list' | 'open';

async function stashRootFolderHandle(project: Project): Promise<SerializedProject> {
	const { rootFolderHandle, ...rest } = project;
	if (rootFolderHandle) {
		await saveHandle({
			kind: 'project-folder',
			id: project.id,
			handle: rootFolderHandle,
			name: rootFolderHandle.name,
			pickedAt: Date.now()
		});
	} else {
		await deleteHandle('project-folder', project.id).catch((error) => {
			logger.warn(`Failed to clean project-folder handle for ${project.id}`, error);
		});
	}
	return rest;
}

async function restoreRootFolderHandle(serialized: SerializedProject): Promise<Project> {
	const record = await getHandle('project-folder', serialized.id);
	if (record) {
		return {
			...serialized,
			// SAFETY: project-folder records always store directory handles.
			rootFolderHandle: record.handle as FileSystemDirectoryHandle,
			rootFolderName: record.name
		};
	}
	// SAFETY: without a stashed handle the record is the plain document.
	return serialized as Project;
}

async function isTrashed(root: FileSystemDirectoryHandle, id: string): Promise<boolean> {
	return exists(root, projectTrashedMarkerPath(id));
}

function upgradeBackupId(projectId: string, fromVersion: number, toVersion: number): string {
	return `${projectId}-backup-v${fromVersion}-v${toVersion}`;
}

async function ensureProjectUpgradeBackup(
	root: FileSystemDirectoryHandle,
	project: Project,
	fromVersion: number,
	toVersion: number
): Promise<void> {
	const backupId = upgradeBackupId(project.id, fromVersion, toVersion);
	await ensureProjectUpgradeBackupTransaction(
		project,
		{ fromVersion, toVersion, createId: () => backupId },
		{
			backupExists: async (id) =>
				(await readJson<SerializedProject>(root, projectJsonPath(id))) !== null,
			copyMediaLinks: async (sourceId, targetId) => {
				const mediaLinks = await readJson<unknown>(root, projectMediaLinksPath(sourceId));
				if (mediaLinks) await writeJsonAtomic(root, projectMediaLinksPath(targetId), mediaLinks);
			},
			copyThumbnail: async (sourceId, targetId) => {
				const thumbnail = await readBlob(root, projectThumbnailPath(sourceId));
				if (thumbnail) await writeBlob(root, projectThumbnailPath(targetId), thumbnail);
			},
			saveBackup: async (backup) => {
				const serialized = await stashRootFolderHandle(backup);
				await writeJsonAtomic(root, projectJsonPath(backup.id), serialized);
				await upsertIndexEntry(root, {
					id: backup.id,
					name: backup.name,
					updatedAt: backup.updatedAt
				});
			},
			removeBackup: async (id) => {
				await removeEntry(root, projectDir(id), { recursive: true }).catch(() => undefined);
				await deleteHandle('project-folder', id).catch(() => undefined);
			}
		}
	);
}

async function rebuildIndex(root: FileSystemDirectoryHandle): Promise<WorkspaceIndexEntry[]> {
	const entries = await listDirectory(root, [PROJECTS_DIR]);
	const indexEntries: WorkspaceIndexEntry[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'directory') continue;
		// Trashed projects are invisible to listings and the index.
		if (await isTrashed(root, entry.name)) continue;
		let project: SerializedProject | null = null;
		try {
			project = await readJson<SerializedProject>(root, projectJsonPath(entry.name));
		} catch (error) {
			if (!(error instanceof WorkspaceFileCorruptError)) throw error;
			logger.warn(`rebuildIndex: skipping corrupt project.json for ${entry.name}`, error);
			continue;
		}
		if (!project) continue;
		indexEntries.push({
			id: project.id,
			name: project.name,
			updatedAt: project.updatedAt
		});
	}
	return indexEntries;
}

/**
 * Rebuild `index.json` from a directory scan, persist it, and return the
 * entries. `persist='best-effort'` serves scanned entries even when the write
 * fails (read-only mounts) because `projects/` is the source of truth.
 */
async function refreshIndex(
	root: FileSystemDirectoryHandle,
	persist: 'required' | 'best-effort' = 'required'
): Promise<WorkspaceIndexEntry[]> {
	return withKeyLock(INDEX_LOCK_KEY, async () => {
		const entries = sortIndexEntries(await rebuildIndex(root));
		try {
			await writeWorkspaceIndex(root, entries);
		} catch (error) {
			if (persist === 'required') throw error;
			logger.warn('refreshIndex: could not persist index.json — serving from scan', error);
		}
		return entries;
	});
}

/**
 * Incrementally add/update a single index entry without re-reading every
 * other project. Falls back to a full scan when the on-disk index is empty.
 */
async function upsertIndexEntry(
	root: FileSystemDirectoryHandle,
	entry: WorkspaceIndexEntry
): Promise<void> {
	await withKeyLock(INDEX_LOCK_KEY, async () => {
		const index = await readWorkspaceIndex(root);
		const baseEntries = index.projects.length > 0 ? index.projects : await rebuildIndex(root);
		const next = baseEntries.some((existing) => existing.id === entry.id)
			? baseEntries.map((existing) => (existing.id === entry.id ? entry : existing))
			: [...baseEntries, entry];
		await writeWorkspaceIndex(root, next);
	});
}

async function loadProjectDocument(
	root: FileSystemDirectoryHandle,
	id: string,
	intent: ProjectLoadIntent
): Promise<Project | undefined> {
	return withKeyLock(`project-upgrade:${id}`, async () => {
		if (await isTrashed(root, id)) return undefined;
		const serialized = await readJson<SerializedProject>(root, projectJsonPath(id));
		if (!serialized) return undefined;
		if (serialized.id !== id) {
			throw new Error(`Project id mismatch: expected ${id}, found ${serialized.id}`);
		}
		const restored = await restoreRootFolderHandle(serialized);
		const migration = migrateProjectDocument(restored);
		const { project, warnings } = migration;
		if (intent === 'open') {
			for (const warning of warnings) {
				logger.warn(`loadProjectDocument(${id}): ${warning.code} - ${warning.message}`);
			}
		}
		if (intent === 'open' && migration.appliedMigrations.length > 0) {
			await ensureProjectUpgradeBackup(root, restored, migration.fromVersion, migration.toVersion);
			const upgraded = await stashRootFolderHandle(project);
			await writeJsonAtomic(root, projectJsonPath(id), upgraded);
		}
		return project;
	});
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getAllProjects(): Promise<Project[]> {
	const root = requireWorkspaceRoot();
	try {
		let entries = (await readWorkspaceIndex(root)).projects;
		if (entries.length === 0) {
			entries = await refreshIndex(root, 'best-effort');
		}
		const projects: Project[] = [];
		for (const entry of entries) {
			try {
				const project = await loadProjectDocument(root, entry.id, 'list');
				if (project) projects.push(project);
			} catch (error) {
				if (!(error instanceof WorkspaceFileCorruptError)) throw error;
				logger.warn(`getAllProjects: skipping corrupt project.json for ${entry.id}`, error);
			}
		}
		return projects;
	} catch (error) {
		throw new Error('Failed to load projects from workspace', { cause: error });
	}
}

export async function getProject(id: string): Promise<Project | undefined> {
	const root = requireWorkspaceRoot();
	try {
		return await loadProjectDocument(root, id, 'open');
	} catch (error) {
		logger.error(`getProject(${id}) failed`, error);
		throw new Error(`Failed to load project: ${id}`, { cause: error });
	}
}

export async function getProjectThumbnail(id: string): Promise<Blob | null> {
	const root = requireWorkspaceRoot();
	try {
		return await readBlob(root, projectThumbnailPath(id));
	} catch (error) {
		logger.warn(`getProjectThumbnail(${id}) failed`, error);
		return null;
	}
}

export async function createProject(project: Project): Promise<Project> {
	const root = requireWorkspaceRoot();
	try {
		const existing = await readJson<SerializedProject>(root, projectJsonPath(project.id));
		if (existing) {
			throw new Error(`Project already exists: ${project.id}`);
		}
		const serialized = await stashRootFolderHandle(project);
		await writeJsonAtomic(root, projectJsonPath(project.id), serialized);
		await upsertIndexEntry(root, {
			id: project.id,
			name: project.name,
			updatedAt: project.updatedAt
		});
		return project;
	} catch (error) {
		logger.error('createProject failed', error);
		throw error;
	}
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project> {
	const root = requireWorkspaceRoot();
	try {
		const existingSerialized = await readJson<SerializedProject>(root, projectJsonPath(id));
		if (!existingSerialized) {
			throw new Error(`Project not found: ${id}`);
		}

		// Merge at the serialized layer — `rootFolderHandle` never lives in
		// project.json. Only touch the handle registry when the caller actually
		// changes the handle; a normal autosave leaves it untouched.
		const handleChanging = 'rootFolderHandle' in updates;
		const { rootFolderHandle, ...serializableUpdates } = updates;
		const updatedAt = Date.now();
		const nextSerialized: SerializedProject = {
			...existingSerialized,
			...serializableUpdates,
			id,
			updatedAt
		};

		if (handleChanging) {
			if (rootFolderHandle) {
				await saveHandle({
					kind: 'project-folder',
					id,
					handle: rootFolderHandle,
					name: rootFolderHandle.name,
					pickedAt: Date.now()
				});
			} else {
				await deleteHandle('project-folder', id).catch((error) => {
					logger.warn(`Failed to clean project-folder handle for ${id}`, error);
				});
			}
		}

		await writeJsonAtomic(root, projectJsonPath(id), nextSerialized);
		await upsertIndexEntry(root, { id, name: nextSerialized.name, updatedAt });
		return restoreRootFolderHandle(nextSerialized);
	} catch (error) {
		logger.error(`updateProject(${id}) failed`, error);
		throw error;
	}
}

export async function deleteProject(id: string): Promise<void> {
	const root = requireWorkspaceRoot();
	try {
		await removeEntry(root, projectDir(id), { recursive: true });
		await deleteHandle('project-folder', id).catch((error) => {
			logger.warn(`Failed to clean project-folder handle for ${id}`, error);
		});
		await refreshIndex(root);
	} catch (error) {
		logger.error(`deleteProject(${id}) failed`, error);
		throw new Error(`Failed to delete project: ${id}`, { cause: error });
	}
}
