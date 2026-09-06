import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrateProjectDocument } from './defaults';
import type { Project } from './types';

describe('sequence project migration', () => {
	it('upgrades single-timeline projects without changing their edit', () => {
		const project: Project = {
			id: 'project',
			name: 'Legacy',
			description: '',
			createdAt: 1,
			updatedAt: 1,
			duration: 1,
			schemaVersion: 1,
			metadata: { width: 1920, height: 1080, fps: 30 },
			timeline: { tracks: [], items: [] }
		};
		const result = migrateProjectDocument(project);
		expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(result.project.timeline?.compositions).toEqual([]);
		expect(result.project.timeline?.topLevelSequenceIds).toEqual([]);
	});

	it('deduplicates tabs and drops ids that do not resolve', () => {
		const project: Project = {
			id: 'project',
			name: 'Sequences',
			description: '',
			createdAt: 1,
			updatedAt: 1,
			duration: 1,
			schemaVersion: 2,
			metadata: { width: 1920, height: 1080, fps: 30 },
			timeline: {
				tracks: [],
				items: [],
				topLevelSequenceIds: ['valid', 'missing', 'valid'],
				compositions: [
					{
						id: 'valid',
						name: 'Valid',
						editorKind: 'sequence',
						items: [],
						tracks: [],
						transitions: [],
						fps: 30,
						width: 1920,
						height: 1080,
						durationInFrames: 0
					}
				]
			}
		};
		const result = migrateProjectDocument(project);
		expect(result.project.timeline?.topLevelSequenceIds).toEqual(['valid']);
		expect(result.warnings.map((warning) => warning.code)).toContain('SEQUENCE_TABS_REPAIRED');
		expect(result.project.timeline?.compositions?.[0]?.tracks.length).toBeGreaterThan(0);
	});

	it('repairs a sequence duration that ends before its content', () => {
		const project: Project = {
			id: 'project',
			name: 'Sequences',
			description: '',
			createdAt: 1,
			updatedAt: 1,
			duration: 1,
			schemaVersion: 2,
			metadata: { width: 1920, height: 1080, fps: 30 },
			timeline: {
				tracks: [],
				items: [],
				compositions: [
					{
						id: 'sequence',
						name: 'Sequence',
						items: [
							{
								id: 'clip',
								trackId: 'video',
								from: 15,
								durationInFrames: 30,
								label: 'Clip',
								type: 'video'
							}
						],
						tracks: [],
						transitions: [],
						fps: 30,
						width: 1920,
						height: 1080,
						durationInFrames: 10
					}
				]
			}
		};
		const result = migrateProjectDocument(project);
		expect(result.project.timeline?.compositions?.[0]?.durationInFrames).toBe(45);
	});
});
