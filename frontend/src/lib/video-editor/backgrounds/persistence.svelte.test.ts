import { describe, expect, it } from 'vitest';
import { createBlankProject, normalizeProject, migrateProjectDocument } from '../project/defaults';
import { cloneProjectDocument } from '../project/project-clone';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { addBackgroundItem, updateBackground } from '../timeline/actions/backgrounds';
import { resolveAnimatedItemAt } from '../timeline/animated-properties';
import type { TimelineItem } from '../project/types';

function ids() {
	let i = 0;
	return () => `id-${++i}`;
}

describe('background persistence, clone, migration, undo', () => {
	it('clone is deep and not shared', () => {
		const project = createBlankProject('Clone');
		project.timeline!.items = [
			{
				id: 'bg1',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 30,
				label: 'BG',
				type: 'background',
				background: {
					kind: 'mesh-gradient',
					colors: ['#111111', '#222222', '#333333', '#444444'],
					smoothness: 0.5,
					rotation: 10,
					scale: 1,
					offsetX: 0,
					offsetY: 0
				}
			}
		];
		const cloned = cloneProjectDocument(project, { createId: ids(), now: 1 });
		const origBg = project.timeline!.items[0]!.background!;
		const cloneBg = cloned.timeline!.items[0]!.background!;
		expect(cloneBg).toEqual(origBg);
		if (cloneBg.kind === 'mesh-gradient' && origBg.kind === 'mesh-gradient') {
			cloneBg.rotation = 99;
			expect(origBg.rotation).toBe(10);
		}
	});

	it('migration v3->v4 backfills background', () => {
		const base = createBlankProject('Mig');
		const project = {
			...base,
			schemaVersion: 3,
			timeline: {
				...base.timeline!,
				items: [
					{
						id: 'bg-mig',
						trackId: 'track-video-main',
						from: 0,
						durationInFrames: 30,
						label: 'Mig',
						type: 'background'
					} satisfies TimelineItem
				]
			}
		};
		const migrated = migrateProjectDocument(project);
		expect(migrated.appliedMigrations).toContain(4);
		expect(migrated.project.timeline!.items[0]!.background).toBeDefined();
	});

	it('undo restores previous background after update', () => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		const project = createBlankProject('Undo');
		timelineStore.setAll({
			tracks: project.timeline!.tracks,
			items: [],
			currentFrame: 0,
			fps: 30
		});
		const id = addBackgroundItem('mesh-sunset');
		const before = timelineStore.itemById.get(id)!.background!;
		expect(before.kind).toBe('mesh-gradient');
		const beforeRotation = before.kind === 'mesh-gradient' ? before.rotation : 0;
		updateBackground(id, { rotation: 45 });
		const after = timelineStore.itemById.get(id)!.background!;
		expect(after.kind === 'mesh-gradient' ? after.rotation : -1).toBe(45);
		commandHistory.undo();
		const undone = timelineStore.itemById.get(id)!.background!;
		expect(undone.kind === 'mesh-gradient' ? undone.rotation : -1).toBe(beforeRotation);
		commandHistory.redo();
		const redone = timelineStore.itemById.get(id)!.background!;
		expect(redone.kind === 'mesh-gradient' ? redone.rotation : -1).toBe(45);
	});
});
