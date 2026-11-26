import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTransition } from '../project/types';
import { clampEditDeltaToPreserveState } from './edit-constraints';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'left',
		trackId: 'video',
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30,
		...overrides
	};
}

const transition: TimelineTransition = {
	id: 'transition',
	type: 'crossfade',
	durationInFrames: 12,
	fromItemId: 'left',
	toItemId: 'right'
};

describe('timeline edit constraints', () => {
	it('blocks a one-sided trim that would detach a transition from its cut', () => {
		const left = item();
		const right = item({ id: 'right', from: 60 });
		expect(
			clampEditDeltaToPreserveState({
				requestedDelta: -10,
				items: [left, right],
				transitions: [transition],
				affectedIds: new Set([left.id]),
				buildUpdates: (delta) => [
					{
						id: left.id,
						patch: { durationInFrames: left.durationInFrames + delta }
					}
				]
			})
		).toBe(0);
	});

	it('stops a trim before a kept keyframe enters the transition region', () => {
		const left = item({
			keyframes: { opacity: { frames: [40], values: [1] } }
		});
		const right = item({ id: 'right', from: 60 });
		expect(
			clampEditDeltaToPreserveState({
				requestedDelta: -20,
				items: [left, right],
				transitions: [transition],
				affectedIds: new Set([left.id]),
				buildUpdates: (delta) => [
					{
						id: left.id,
						patch: { durationInFrames: left.durationInFrames + delta }
					},
					{ id: right.id, patch: { from: right.from + delta } }
				]
			})
		).toBe(-13);
	});
});
