import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { sourceSecondsToTimelineFrame } from './media-item-frames';

describe('media item frame mapping', () => {
	it('inverts the variable-speed curve used by preview and export', () => {
		const item = {
			id: 'ramped',
			trackId: 'video',
			from: 20,
			durationInFrames: 90,
			label: 'Ramped clip',
			type: 'video',
			sourceStart: 0,
			sourceEnd: 120,
			sourceFps: 30,
			speed: 1,
			speedRamp: [
				{ id: 'normal-in', sourceFrame: 0, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
				{ id: 'normal-out', sourceFrame: 90, speed: 1, easing: 'hold' },
				{ id: 'end', sourceFrame: 120, speed: 1, easing: 'linear' }
			]
		} satisfies TimelineItem;

		expect(sourceSecondsToTimelineFrame(item, 0, 30)).toBe(20);
		expect(sourceSecondsToTimelineFrame(item, 1, 30)).toBe(50);
		expect(sourceSecondsToTimelineFrame(item, 3, 30)).toBe(80);
		expect(sourceSecondsToTimelineFrame(item, 4, 30)).toBe(110);
	});

	it('maps reversed source seconds from the exclusive out point back across the timeline', () => {
		const item: TimelineItem = {
			id: 'reversed',
			trackId: 'video',
			from: 100,
			durationInFrames: 90,
			label: 'Reversed clip',
			type: 'video',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1,
			isReversed: true
		};

		expect(sourceSecondsToTimelineFrame(item, 3, 30)).toBe(100);
		expect(sourceSecondsToTimelineFrame(item, 2, 30)).toBe(130);
		expect(sourceSecondsToTimelineFrame(item, 1, 30)).toBe(160);
	});
});
