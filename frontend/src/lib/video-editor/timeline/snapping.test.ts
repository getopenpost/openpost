import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import {
	buildSnapTargets,
	calculateAdaptiveSnapThreshold,
	calculateMoveSnap,
	findNearestSnapTarget,
	timelineNavigationSnapPoints
} from './snapping';

const tracks: TimelineTrack[] = [
	{
		id: 'visible',
		name: 'Visible',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	},
	{
		id: 'hidden',
		name: 'Hidden',
		kind: 'video',
		height: 64,
		locked: false,
		visible: false,
		muted: false,
		solo: false,
		order: 1
	}
];

function item(id: string, trackId: string, from: number, durationInFrames: number): TimelineItem {
	return { id, trackId, from, durationInFrames, label: id, type: 'video' };
}

describe('timeline snapping', () => {
	it('keeps the magnetic hit area stable in screen space as zoom changes', () => {
		expect(calculateAdaptiveSnapThreshold(1, 4)).toBe(2);
		expect(calculateAdaptiveSnapThreshold(4, 16)).toBe(1);
		expect(calculateAdaptiveSnapThreshold(0.25, 1)).toBe(16);
	});

	it('builds targets from visible item edges, the playhead, markers, and the adaptive grid', () => {
		const items = [
			item('dragged', 'visible', 10, 20),
			item('target', 'visible', 60, 15),
			item('hidden-item', 'hidden', 90, 10)
		];
		const transitions: TimelineTransition[] = [];
		const targets = buildSnapTargets({
			items,
			tracks,
			transitions,
			markers: [{ id: 'm1', frame: 45, color: '#fff' }],
			currentFrame: 33,
			durationInFrames: 300,
			fps: 30,
			zoomLevel: 1,
			excludeItemIds: ['dragged']
		});

		expect(targets).toContainEqual({ frame: 60, type: 'item-start', itemId: 'target' });
		expect(targets).toContainEqual({ frame: 75, type: 'item-end', itemId: 'target' });
		expect(targets).toContainEqual({ frame: 33, type: 'playhead' });
		expect(targets).toContainEqual({ frame: 45, type: 'marker', markerId: 'm1' });
		expect(targets).toContainEqual({ frame: 0, type: 'grid' });
		expect(targets.some((target) => target.itemId === 'dragged')).toBe(false);
		expect(targets.some((target) => target.itemId === 'hidden-item')).toBe(false);
	});

	it('builds deduplicated navigation points from visible edit edges and markers', () => {
		const left = item('left', 'visible', 0, 100);
		const right = item('right', 'visible', 100, 50);
		expect(
			timelineNavigationSnapPoints({
				items: [left, right, item('hidden-item', 'hidden', 75, 20)],
				tracks,
				transitions: [
					{
						id: 'transition',
						type: 'crossfade',
						durationInFrames: 20,
						fromItemId: left.id,
						toItemId: right.id
					}
				],
				markers: [
					{ id: 'at-cut', frame: 100, color: '#fff' },
					{ id: 'later', frame: 125, color: '#fff' }
				]
			})
		).toEqual([0, 100, 125, 150]);
	});

	it('snaps the closer clip edge and keeps magnetic targets ahead of an equal grid target', () => {
		const targets = [
			{ frame: 60, type: 'grid' as const },
			{ frame: 60, type: 'item-start' as const, itemId: 'target' }
		];
		expect(calculateMoveSnap(58, 20, targets, 4)).toEqual({
			snappedFrame: 60,
			snapTarget: { frame: 60, type: 'item-start', itemId: 'target' },
			didSnap: true
		});
		expect(calculateMoveSnap(39, 20, targets, 4).snappedFrame).toBe(40);
	});

	it('uses the visual center of a cut-centered transition as its magnetic target', () => {
		const left = item('left', 'visible', 0, 100);
		const right = item('right', 'visible', 100, 100);
		const targets = buildSnapTargets({
			items: [left, right],
			tracks,
			transitions: [
				{
					id: 'transition',
					type: 'crossfade',
					durationInFrames: 20,
					fromItemId: left.id,
					toItemId: right.id
				}
			],
			markers: [],
			currentFrame: 0,
			durationInFrames: 240,
			fps: 30,
			zoomLevel: 1
		});

		expect(targets).toContainEqual({ frame: 100, type: 'item-start', itemId: right.id });
		expect(targets.some((target) => target.type === 'item-end' && target.itemId === left.id)).toBe(
			false
		);
	});

	it('uses a strict threshold so an edge exactly on the boundary stays unsnapped', () => {
		expect(findNearestSnapTarget(10, [{ frame: 12, type: 'playhead' }], 2)).toBeNull();
	});

	it('keeps indexed nearest-target lookup identical to the public linear path', () => {
		const targets = buildSnapTargets({
			items: Array.from({ length: 200 }, (_, index) =>
				item(`clip-${index}`, 'visible', index * 11, 7)
			),
			tracks,
			transitions: [],
			markers: [
				{ id: 'one', frame: 333, color: '#fff' },
				{ id: 'two', frame: 777, color: '#fff' }
			],
			currentFrame: 555,
			durationInFrames: 2_400,
			fps: 30,
			zoomLevel: 1
		});
		const linearTargets = [...targets];
		for (const threshold of [1, 3, 17]) {
			for (let frame = 0; frame <= 2_400; frame += 7) {
				expect(findNearestSnapTarget(frame, targets, threshold)).toEqual(
					findNearestSnapTarget(frame, linearTargets, threshold)
				);
			}
		}
	});
});
