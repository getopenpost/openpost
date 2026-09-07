import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { visibleScrubTextItems } from './text-scrub-items';

function item(partial: Partial<TimelineItem>): TimelineItem {
	const base = {
		id: 'item',
		trackId: 'track',
		from: 0,
		durationInFrames: 30,
		label: '',
		type: 'text'
	};
	// SAFETY: the partial only overrides known TimelineItem fields in these tests.
	return { ...base, ...partial } as TimelineItem;
}

describe('visibleScrubTextItems', () => {
	it('selects text and subtitle items covering the frame', () => {
		const items = [
			item({ id: 'text', type: 'text', from: 10, durationInFrames: 20 }),
			item({ id: 'caption', type: 'subtitle', from: 0, durationInFrames: 100 }),
			item({ id: 'video', type: 'video', from: 0, durationInFrames: 100 }),
			item({ id: 'audio', type: 'audio', from: 0, durationInFrames: 100 })
		];
		expect(visibleScrubTextItems(items, 15).map((entry) => entry.id)).toEqual(['text', 'caption']);
	});

	it('treats the end boundary as exclusive', () => {
		const items = [item({ id: 'text', type: 'text', from: 10, durationInFrames: 20 })];
		expect(visibleScrubTextItems(items, 30)).toEqual([]);
		expect(visibleScrubTextItems(items, 29).map((entry) => entry.id)).toEqual(['text']);
	});

	it('returns nothing for non-finite frames', () => {
		const items = [item({ id: 'text', type: 'text', from: 0, durationInFrames: 30 })];
		expect(visibleScrubTextItems(items, Number.NaN)).toEqual([]);
	});
});
