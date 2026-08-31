import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { expandMotionLayerItemIds, planMotionTimelineRows } from './motion-timeline-rows';

function track(id: string, order: number, overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...overrides
	};
}

function item(
	id: string,
	trackId: string,
	type: TimelineItem['type'] = 'video',
	overrides: Partial<TimelineItem> = {}
): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 90,
		label: id,
		type,
		...overrides
	};
}

describe('Motion timeline row planning', () => {
	it('shows a linked audiovisual pair as one layer and expands edits to both items', () => {
		const tracks = [track('video', 0), track('audio', 1, { kind: 'audio' })];
		const items = [
			item('picture', 'video', 'video', { linkedGroupId: 'pair', mediaId: 'source' }),
			item('sound', 'audio', 'audio', { linkedGroupId: 'pair', mediaId: 'source' })
		];
		const plan = planMotionTimelineRows({ items, tracks });

		expect(plan.rows).toEqual([
			{
				kind: 'layer',
				item: items[0],
				track: tracks[0],
				depth: 0,
				itemIds: ['picture', 'sound']
			}
		]);
		expect(expandMotionLayerItemIds(plan, ['picture'])).toEqual(['picture', 'sound']);
		expect(expandMotionLayerItemIds(plan, ['sound'])).toEqual(['picture', 'sound']);
	});

	it('keeps a collapsed group as one row while preserving its child item ids', () => {
		const group = track('group', 0, {
			isGroup: true,
			kind: undefined,
			isCollapsed: true
		});
		const childA = track('child-a', 1, { parentTrackId: group.id });
		const childB = track('child-b', 2, { parentTrackId: group.id });
		const items = [item('later', childA.id, 'image', { from: 30 }), item('first', childB.id)];
		const plan = planMotionTimelineRows({ items, tracks: [group, childA, childB] });

		expect(plan.rows).toEqual([{ kind: 'group', track: group, itemIds: ['later', 'first'] }]);
		expect(expandMotionLayerItemIds(plan, ['later'])).toEqual(['later']);
	});

	it('orders expanded children by track and time, then appends orphan layers', () => {
		const group = track('group', 0, { isGroup: true, kind: undefined });
		const child = track('child', 1, { parentTrackId: group.id });
		const loose = track('loose', 2);
		const items = [
			item('child-late', child.id, 'shape', { from: 40 }),
			item('orphan', 'missing', 'text', { from: 0 }),
			item('loose', loose.id, 'image', { from: 0 }),
			item('child-early', child.id, 'video', { from: 10 }),
			item('captions', child.id, 'subtitle')
		];
		const plan = planMotionTimelineRows({ items, tracks: [loose, child, group] });

		expect(
			plan.rows.map((row) =>
				row.kind === 'group' ? `group:${row.track.id}` : `${row.depth}:${row.item.id}`
			)
		).toEqual(['group:group', '1:child-early', '1:child-late', '0:loose', '0:orphan']);
	});

	it('matches composition audio by both linked group and source composition', () => {
		const tracks = [track('visual', 0), track('audio', 1, { kind: 'audio' })];
		const items = [
			item('wrapper-a', 'visual', 'composition', {
				linkedGroupId: 'shared',
				compositionId: 'composition-a'
			}),
			item('sound-b', 'audio', 'audio', {
				linkedGroupId: 'shared',
				compositionId: 'composition-b'
			}),
			item('sound-a', 'audio', 'audio', {
				linkedGroupId: 'shared',
				compositionId: 'composition-a'
			})
		];
		const plan = planMotionTimelineRows({ items, tracks });

		expect(plan.rows.map((row) => row.itemIds)).toEqual([['wrapper-a', 'sound-a'], ['sound-b']]);
		expect(expandMotionLayerItemIds(plan, ['wrapper-a'])).toEqual(['wrapper-a', 'sound-a']);
	});
});
