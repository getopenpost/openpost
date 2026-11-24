import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { buildSnapTargets, calculateMoveSnap } from './snapping';

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

		expect(targets).toContainEqual({
			frame: 60,
			type: 'item-start',
			itemId: 'target'
		});
		expect(targets).toContainEqual({
			frame: 75,
			type: 'item-end',
			itemId: 'target'
		});
		expect(targets).toContainEqual({ frame: 33, type: 'playhead' });
		expect(targets).toContainEqual({
			frame: 45,
			type: 'marker',
			markerId: 'm1'
		});
		expect(targets).toContainEqual({ frame: 0, type: 'grid' });
		expect(targets.some((target) => target.itemId === 'dragged')).toBe(false);
		expect(targets.some((target) => target.itemId === 'hidden-item')).toBe(false);
	});

	it('excludes items on tracks hidden through a parent group', () => {
		const groupTrack: TimelineTrack = {
			id: 'group',
			name: 'Group',
			kind: 'video',
			height: 64,
			locked: false,
			visible: false,
			muted: false,
			solo: false,
			order: 0,
			isGroup: true
		};
		const childTrack: TimelineTrack = {
			id: 'child',
			name: 'Child',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 1,
			parentTrackId: 'group'
		};
		const targets = buildSnapTargets({
			items: [item('grouped', 'child', 50, 10)],
			tracks: [groupTrack, childTrack],
			transitions: [],
			markers: [],
			currentFrame: 0,
			durationInFrames: 300,
			fps: 30,
			zoomLevel: 1
		});
		expect(targets.some((target) => target.itemId === 'grouped')).toBe(false);
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
});
