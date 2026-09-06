import type { Project } from './types';

export interface ProjectUpgradeBackupOptions {
	fromVersion: number;
	toVersion: number;
	name?: string;
	now?: number;
	createId?: () => string;
}

export interface ProjectUpgradeBackupRuntime {
	backupExists(id: string): Promise<boolean>;
	copyMediaLinks(sourceId: string, backupId: string): Promise<void>;
	copyThumbnail(sourceId: string, backupId: string): Promise<void>;
	saveBackup(project: Project): Promise<void>;
	removeBackup(id: string): Promise<void>;
}

/**
 * Keep the stored document shape intact so a backup can recover from a bad
 * migration. Internal IDs stay unchanged because they are scoped by project.
 */
export function createProjectUpgradeBackupDocument(
	project: Project,
	options: ProjectUpgradeBackupOptions
): Project {
	const now = options.now ?? Date.now();
	const createId = options.createId ?? (() => crypto.randomUUID());
	const { rootFolderHandle, ...serializable } = project;
	const backup = structuredClone(serializable);
	return {
		...backup,
		id: createId(),
		name:
			options.name ??
			`${project.name} backup (schema ${options.fromVersion} to ${options.toVersion})`,
		createdAt: now,
		updatedAt: now,
		...(rootFolderHandle && { rootFolderHandle })
	};
}

export async function ensureProjectUpgradeBackup(
	project: Project,
	options: ProjectUpgradeBackupOptions,
	runtime: ProjectUpgradeBackupRuntime
): Promise<Project> {
	const backup = createProjectUpgradeBackupDocument(project, options);
	if (await runtime.backupExists(backup.id)) return backup;
	try {
		await runtime.copyMediaLinks(project.id, backup.id);
		await runtime.copyThumbnail(project.id, backup.id);
		await runtime.saveBackup(backup);
		return backup;
	} catch (error) {
		await runtime.removeBackup(backup.id).catch(() => undefined);
		throw error;
	}
}
