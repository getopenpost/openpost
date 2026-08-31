import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { buildTimelineItemRangeIndex } from './timeline-viewport';
import { planTimelineWaveformDemand } from './waveform-demand';

function item(id: string, from: number, mediaId = id): TimelineItem {
	return {
		id,
		trackId: 'audio-track',
		from,
		durationInFrames: 50,
		label: id,
		type: 'audio',
		mediaId
	};
}

function demand(overrides: Partial<Parameters<typeof planTimelineWaveformDemand>[0]> = {}) {
	return planTimelineWaveformDemand({
		items: [],
		scrollLeft: 0,
		previousScrollLeft: 0,
		viewportWidth: 500,
		headerWidth: 180,
		pixelsPerFrame: 4,
		...overrides
	});
}

describe('timeline waveform demand', () => {
	it('keeps visible sources first and excludes distant clips', () => {
		expect(
			demand({ items: [item('visible', 20), item('ahead', 160), item('far', 2_000)] })
		).toEqual(['visible', 'ahead']);
	});

	it('biases prefetch toward the current scroll direction', () => {
		const items = [item('left', 20), item('right', 250)];
		expect(demand({ items, scrollLeft: 800, previousScrollLeft: 700 })).toContain('right');
		expect(demand({ items, scrollLeft: 800, previousScrollLeft: 900 })).toContain('left');
	});

	it('deduplicates repeated clips from the same media source', () => {
		expect(demand({ items: [item('one', 10, 'shared'), item('two', 70, 'shared')] })).toEqual([
			'shared'
		]);
	});

	it('uses the interval index without changing viewport ordering', () => {
		const items = [
			item('far-left', 0),
			item('visible', 220),
			item('ahead', 410),
			item('far', 20_000)
		];
		const input = {
			scrollLeft: 800,
			previousScrollLeft: 700,
			viewportWidth: 500,
			headerWidth: 180,
			pixelsPerFrame: 4
		};
		expect(
			planTimelineWaveformDemand({ ...input, itemIndex: buildTimelineItemRangeIndex(items) })
		).toEqual(planTimelineWaveformDemand({ ...input, items }));
	});

	it('ignores non-media items and unusable viewport geometry', () => {
		const text = { ...item('title', 0), type: 'text' as const };
		expect(demand({ items: [text] })).toEqual([]);
		expect(demand({ items: [item('audio', 0)], viewportWidth: 180 })).toEqual([]);
		expect(demand({ items: [item('audio', 0)], pixelsPerFrame: 0 })).toEqual([]);
	});
});
