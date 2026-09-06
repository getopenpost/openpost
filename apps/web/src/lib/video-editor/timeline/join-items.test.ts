import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	canJoinItems,
	canJoinMultipleItems,
	joinableItemNeighbors,
	joinedTimelineItem
} from './join-items';

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'left',
		originId: 'source-edit',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		mediaId: 'media',
		sourceStart: 0,
		sourceEnd: 30,
		sourceFps: 30,
		...overrides
	};
}

describe('join item planning', () => {
	it('accepts a continuous split chain and restores its full source window', () => {
		const left = clip();
		const middle = clip({ id: 'middle', from: 30, sourceStart: 30, sourceEnd: 60 });
		const right = clip({ id: 'right', from: 60, sourceStart: 60, sourceEnd: 90 });
		expect(canJoinMultipleItems([right, left, middle])).toBe(true);
		expect(joinedTimelineItem([right, left, middle])).toMatchObject({
			id: 'left',
			from: 0,
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 90
		});
	});

	it('restores descending source bounds for reversed split siblings', () => {
		const left = clip({ sourceStart: 60, sourceEnd: 90, isReversed: true });
		const right = clip({
			id: 'right',
			from: 30,
			sourceStart: 30,
			sourceEnd: 60,
			isReversed: true
		});
		expect(canJoinItems(left, right)).toBe(true);
		expect(joinedTimelineItem([left, right])).toMatchObject({
			sourceStart: 30,
			sourceEnd: 90,
			isReversed: true
		});
	});

	it('resolves the continuous split siblings on either side of one clip', () => {
		const left = clip();
		const middle = clip({ id: 'middle', from: 30, sourceStart: 30, sourceEnd: 60 });
		const right = clip({ id: 'right', from: 60, sourceStart: 60, sourceEnd: 90 });
		const unrelated = clip({
			id: 'unrelated',
			originId: 'other',
			from: 60,
			sourceStart: 60,
			sourceEnd: 90
		});

		expect(joinableItemNeighbors([unrelated, right, left, middle], middle)).toEqual({
			previous: left,
			next: right
		});
		expect(joinableItemNeighbors([middle, unrelated], middle)).toEqual({});
	});

	it('rejects gaps, different speeds, directions, sources, tracks, and lineages', () => {
		const left = clip();
		const baseRight = clip({ id: 'right', from: 30, sourceStart: 30, sourceEnd: 60 });
		expect(canJoinItems(left, { ...baseRight, from: 31 })).toBe(false);
		expect(canJoinItems(left, { ...baseRight, speed: 2 })).toBe(false);
		expect(canJoinItems(left, { ...baseRight, isReversed: true })).toBe(false);
		expect(canJoinItems(left, { ...baseRight, mediaId: 'other' })).toBe(false);
		expect(canJoinItems(left, { ...baseRight, trackId: 'other' })).toBe(false);
		expect(canJoinItems(left, { ...baseRight, originId: 'other' })).toBe(false);
	});
});
