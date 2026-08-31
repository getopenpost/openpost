import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { planTrimCompositionToRange } from './trim-composition-range';

function track(id: string, locked = false, parentTrackId?: string): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 80,
		locked,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		parentTrackId
	};
}

function item(id: string, from: number, durationInFrames: number): TimelineItem {
	return {
		id,
		trackId: 'video',
		from,
		durationInFrames,
		label: id,
		type: 'video',
		mediaId: `${id}-media`,
		sourceStart: 100,
		sourceEnd: 100 + durationInFrames,
		sourceDuration: 1_000,
		sourceFps: 30,
		speed: 1
	};
}

function transition(id: string, fromItemId: string, toItemId: string): TimelineTransition {
	return {
		id,
		type: 'crossfade',
		durationInFrames: 10,
		fromItemId,
		toItemId
	};
}

describe('planTrimCompositionToRange', () => {
	it('trims both source edges, shifts the kept clip, and removes dangling state', () => {
		const plan = planTrimCompositionToRange({
			items: [item('outside', 0, 20), item('kept', 20, 100)],
			tracks: [track('video')],
			transitions: [transition('dangling', 'outside', 'kept')],
			markers: [
				{ id: 'before', frame: 10, color: '#fff' },
				{ id: 'inside', frame: 55, color: '#fff' },
				{ id: 'after', frame: 110, color: '#fff' }
			],
			inPoint: 40,
			outPoint: 100,
			currentFrame: 70,
			fps: 30
		});

		expect(plan).toEqual({
			ok: true,
			updates: [
				{
					id: 'kept',
					patch: {
						from: 0,
						durationInFrames: 60,
						sourceStart: 120,
						sourceEnd: 180
					}
				}
			],
			removeIds: ['outside'],
			transitions: [],
			markers: [{ id: 'inside', frame: 15, color: '#fff' }],
			durationInFrames: 60,
			currentFrame: 30
		});
	});

	it('keeps valid transitions and avoids updates for an unchanged zero-based range', () => {
		const left = item('left', 0, 30);
		const right = item('right', 30, 30);
		const linked = transition('linked', left.id, right.id);
		const plan = planTrimCompositionToRange({
			items: [left, right],
			tracks: [track('video')],
			transitions: [linked],
			markers: [],
			inPoint: 0,
			outPoint: 60,
			currentFrame: 59,
			fps: 30
		});

		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.updates).toEqual([]);
		expect(plan.transitions).toEqual([linked]);
	});

	it('blocks the whole operation when an affected track or parent group is locked', () => {
		const group = { ...track('group', true), isGroup: true, kind: undefined };
		const child = track('video', false, group.id);
		expect(
			planTrimCompositionToRange({
				items: [item('clip', 10, 30)],
				tracks: [group, child],
				transitions: [],
				markers: [],
				inPoint: 10,
				outPoint: 30,
				currentFrame: 10,
				fps: 30
			})
		).toEqual({ ok: false, reason: 'locked-track' });
	});
});
