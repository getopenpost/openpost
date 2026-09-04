import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	buildEditableBaseSpans,
	buildSpanLayout,
	buildTextSingleLayoutDraft,
	cloneTextLayoutDrafts,
	getTextItemLayoutMode
} from './text-layout-drafts';

function textItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: 'Headline',
		text: 'Headline',
		type: 'text',
		color: '#ffffff',
		...overrides
	};
}

describe('text layout drafts', () => {
	it('clones saved drafts without sharing span references', () => {
		const source = {
			single: { text: 'Single' },
			twoSpans: [{ text: 'Title' }, { text: 'Subtitle' }]
		};
		const copy = cloneTextLayoutDrafts(source)!;
		copy.single!.text = 'Changed';
		copy.twoSpans![0]!.text = 'Changed';
		expect(source).toEqual({
			single: { text: 'Single' },
			twoSpans: [{ text: 'Title' }, { text: 'Subtitle' }]
		});
	});
});
