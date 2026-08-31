import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, getMigrationsToApply } from './migrations';
import { createBlankProject } from './defaults';

describe('project migration registry', () => {
	it('returns an ordered contiguous migration plan', () => {
		expect(getMigrationsToApply(1, CURRENT_SCHEMA_VERSION).map((entry) => entry.version)).toEqual([
			2, 3, 4, 5, 6
		]);
		expect(getMigrationsToApply(CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)).toEqual([]);
	});

	it('fails closed when a target version has no migration', () => {
		expect(() => getMigrationsToApply(CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1)).toThrow(
			`Missing project migration for schema ${CURRENT_SCHEMA_VERSION + 1}`
		);
	});

	it('converts legacy ratio crop keys to source pixels without changing pixel graph edits', () => {
		const project = createBlankProject();
		project.schemaVersion = 5;
		project.timeline.items = [
			{
				id: 'video',
				trackId: project.timeline.tracks[0]!.id,
				from: 0,
				durationInFrames: 30,
				label: 'Video',
				type: 'video',
				sourceWidth: 1280,
				sourceHeight: 720,
				keyframes: {
					cropLeft: { frames: [0, 15, 29], values: [0, 0.25, 160] },
					cropSoftness: { frames: [0, 29], values: [-0.5, 12] }
				}
			}
		];

		const migration = getMigrationsToApply(5, 6)[0]!;
		const migrated = migration.migrate(project);

		expect(migrated.timeline.items[0]?.keyframes?.cropLeft?.values).toEqual([0, 320, 160]);
		expect(migrated.timeline.items[0]?.keyframes?.cropSoftness?.values).toEqual([-360, 12]);
	});
});
