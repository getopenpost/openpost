import { describe, expect, it } from 'vitest';
import { createBlankProject } from './defaults';
import {
	createProjectUpgradeBackupDocument,
	ensureProjectUpgradeBackup,
	type ProjectUpgradeBackupRuntime
} from './project-upgrade';

describe('project upgrade backup', () => {
	it('preserves the legacy schema and every internal timeline id', () => {
		const project = createBlankProject('Legacy cut');
		project.schemaVersion = 1;
		project.timeline!.items = [
			{
				id: 'clip',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 30,
				label: 'Clip',
				type: 'video',
				originId: 'origin'
			}
		];

		const backup = createProjectUpgradeBackupDocument(project, {
			fromVersion: 1,
			toVersion: 3,
			now: 500,
			createId: () => 'backup'
		});

		expect(backup).toMatchObject({
			id: 'backup',
			name: 'Legacy cut backup (schema 1 to 3)',
			schemaVersion: 1,
			createdAt: 500,
			updatedAt: 500
		});
		expect(backup.timeline?.items[0]).toEqual(project.timeline?.items[0]);
		expect(project.id).not.toBe(backup.id);
	});
});

function runtime(options: { failSave?: boolean } = {}) {
	const calls: string[] = [];
	const backups = new Map<string, ReturnType<typeof createBlankProject>>();
	const storage: ProjectUpgradeBackupRuntime = {
		backupExists: async (id) => backups.has(id),
		copyMediaLinks: async (sourceId, backupId) => {
			calls.push(`media:${sourceId}:${backupId}`);
		},
		copyThumbnail: async (sourceId, backupId) => {
			calls.push(`thumbnail:${sourceId}:${backupId}`);
		},
		saveBackup: async (project) => {
			calls.push(`save:${project.id}`);
			if (options.failSave) throw new Error('save failed');
			backups.set(project.id, project);
		},
		removeBackup: async (id) => {
			calls.push(`remove:${id}`);
			backups.delete(id);
		}
	};
	return { backups, calls, storage };
}

describe('project upgrade backup transaction', () => {
	it('copies linked files before committing the backup document', async () => {
		const project = createBlankProject('Legacy');
		project.id = 'source';
		const testRuntime = runtime();

		await ensureProjectUpgradeBackup(
			project,
			{ fromVersion: 1, toVersion: 3, createId: () => 'backup' },
			testRuntime.storage
		);

		expect(testRuntime.calls).toEqual([
			'media:source:backup',
			'thumbnail:source:backup',
			'save:backup'
		]);
		expect(testRuntime.backups.get('backup')?.schemaVersion).toBe(project.schemaVersion);
	});

	it('removes partial backup files when the final document write fails', async () => {
		const project = createBlankProject('Legacy');
		const testRuntime = runtime({ failSave: true });

		await expect(
			ensureProjectUpgradeBackup(
				project,
				{ fromVersion: 1, toVersion: 3, createId: () => 'backup' },
				testRuntime.storage
			)
		).rejects.toThrow('save failed');
		expect(testRuntime.calls.at(-1)).toBe('remove:backup');
	});

	it('reuses a committed deterministic backup without copying files again', async () => {
		const project = createBlankProject('Legacy');
		const testRuntime = runtime();
		testRuntime.backups.set('backup', { ...project, id: 'backup' });

		await ensureProjectUpgradeBackup(
			project,
			{ fromVersion: 1, toVersion: 3, createId: () => 'backup' },
			testRuntime.storage
		);
		expect(testRuntime.calls).toEqual([]);
	});
});
