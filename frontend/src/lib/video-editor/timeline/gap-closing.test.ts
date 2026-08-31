import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { buildTrackGapClosePlan, findTrackGapAtFrame } from './gap-closing';

function item(id: string, from: number, durationInFrames: number): TimelineItem {
	return {
		id,
		trackId: 'video',
		from,
		durationInFrames,
		label: id,
		type: 'video'
	};
}

describe('timeline gap closing plans', () => {
	const items = [
		item('overlap-a', 20, 40),
		item('overlap-b', 50, 30),
		item('middle', 100, 20),
		item('last', 150, 10),
		{ ...item('other-track', 25, 10), trackId: 'audio' }
	];

	it('finds only leading and bounded gaps, including around overlapping clips', () => {
		expect(findTrackGapAtFrame(items, 'video', 10)).toEqual({ start: 0, end: 20 });
		expect(findTrackGapAtFrame(items, 'video', 70)).toBeNull();
		expect(findTrackGapAtFrame(items, 'video', 90)).toEqual({ start: 80, end: 100 });
		expect(findTrackGapAtFrame(items, 'video', 160)).toBeNull();
	});

	it('plans every left shift against the original timeline without collapsing overlaps', () => {
		expect(buildTrackGapClosePlan(items, 'video')).toEqual({
			intervals: [
				{ start: 0, end: 20 },
				{ start: 80, end: 100 },
				{ start: 120, end: 150 }
			],
			updates: [
				{ id: 'overlap-a', from: 0 },
				{ id: 'overlap-b', from: 30 },
				{ id: 'middle', from: 60 },
				{ id: 'last', from: 80 }
			]
		});
	});

	it('plans only the gap under the requested frame', () => {
		expect(buildTrackGapClosePlan(items, 'video', 90)).toEqual({
			intervals: [{ start: 80, end: 100 }],
			updates: [
				{ id: 'middle', from: 80 },
				{ id: 'last', from: 130 }
			]
		});
		expect(buildTrackGapClosePlan(items, 'video', 70)).toBeNull();
	});
});
