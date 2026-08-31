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
	it('normalizes missing background on legacy item', () => {
		const project = createBlankProject('Test');
		const legacy: TimelineItem = {
			id: 'bg-legacy',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'Legacy bg',
			type: 'background'
		};
		project.timeline!.items = [legacy];
		const { project: normalized } = normalizeProject(project);
		expect(normalized.timeline!.items[0]!.background?.kind).toBe('mesh-gradient');
	});

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

	it('keyframe animation resolves per frame deterministically', () => {
		const item: TimelineItem = {
			id: 'bg-kf',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 30,
			label: 'BG',
			type: 'background',
			background: {
				kind: 'mesh-gradient',
				colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
				smoothness: 0.5,
				rotation: 0,
				scale: 1,
				offsetX: 0,
				offsetY: 0
			},
			keyframes: {
				backgroundRotation: {
					frames: [0, 10],
					values: [0, 90],
					ids: ['a', 'b'],
					easings: ['linear', 'linear']
				}
			}
		};
		const at0 = resolveAnimatedItemAt(item, 0, { fps: 30, frameWidth: 1920, frameHeight: 1080 });
		const at5 = resolveAnimatedItemAt(item, 5, { fps: 30, frameWidth: 1920, frameHeight: 1080 });
		const at10 = resolveAnimatedItemAt(item, 10, { fps: 30, frameWidth: 1920, frameHeight: 1080 });
		expect(at0.background?.kind === 'mesh-gradient' ? at0.background.rotation : -1).toBe(0);
		expect(at5.background?.kind === 'mesh-gradient' ? at5.background.rotation : -1).toBeCloseTo(45);
		expect(at10.background?.kind === 'mesh-gradient' ? at10.background.rotation : -1).toBe(90);
		expect(
			resolveAnimatedItemAt(item, 5, { fps: 30, frameWidth: 1920, frameHeight: 1080 })
		).toEqual(at5);
	});

	it('preset application clones rather than sharing mutable state', async () => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore.setAll({
			tracks: createBlankProject('P').timeline!.tracks,
			items: [],
			currentFrame: 0,
			fps: 30
		});
		const a = addBackgroundItem('pattern-dots');
		const b = addBackgroundItem('pattern-dots');
		const bgA = timelineStore.itemById.get(a)!.background;
		const bgB = timelineStore.itemById.get(b)!.background;
		expect(bgA?.kind === 'pattern' ? bgA.foreground : '').toBe(
			bgB?.kind === 'pattern' ? bgB.foreground : ''
		);
		updateBackground(a, { foreground: '#123456' });
		const afterA = timelineStore.itemById.get(a)!.background;
		const afterB = timelineStore.itemById.get(b)!.background;
		expect(afterA && afterA.kind === 'pattern' ? afterA.foreground : '').toBe('#123456');
		expect(afterB && afterB.kind === 'pattern' ? afterB.foreground : '').toBe('#ff7a18');
	});
});
