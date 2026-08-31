import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	colorClipStartFrameIndex,
	colorTimelineFrameFromClientX,
	isColorTimelineItem,
	resolveColorTimelineMaxFrame
} from './color-mini-timeline';

function item(type: TimelineItem['type']): TimelineItem {
	return {
		id: type,
		trackId: 'track',
		from: 0,
		durationInFrames: 30,
		label: type,
		type
	};
}

describe('color mini timeline', () => {
	it('keeps visual grading items while excluding audio, subtitles, and controllers', () => {
		const visualTypes: TimelineItem['type'][] = [
			'video',
			'image',
			'text',
			'shape',
			'adjustment',
			'composition'
		];
		expect(visualTypes.filter((type) => isColorTimelineItem(item(type)))).toEqual(visualTypes);
		expect(isColorTimelineItem(item('audio'))).toBe(false);
		expect(isColorTimelineItem(item('subtitle'))).toBe(false);
		expect(isColorTimelineItem(item('controller'))).toBe(false);
	});

	it('covers clip ends, markers, range points, and a useful empty minimum', () => {
		expect(
			resolveColorTimelineMaxFrame({
				items: [{ from: 100, durationInFrames: 40 }],
				markers: [{ frame: 470 }],
				inPoint: 20,
				outPoint: 600,
				fps: 30
			})
		).toBe(600);
		expect(resolveColorTimelineMaxFrame({ items: [], fps: 24 })).toBe(240);
	});

	it('maps the usable track area and clamps both outer edges', () => {
		const input = { left: 100, width: 500, labelWidth: 50, maxFrame: 900 };
		expect(colorTimelineFrameFromClientX({ ...input, clientX: 50 })).toBe(0);
		expect(colorTimelineFrameFromClientX({ ...input, clientX: 150 })).toBe(0);
		expect(colorTimelineFrameFromClientX({ ...input, clientX: 375 })).toBe(450);
		expect(colorTimelineFrameFromClientX({ ...input, clientX: 700 })).toBe(900);
	});

	it('uses the clip source start for its film tile instead of the import poster frame', () => {
		expect(
			colorClipStartFrameIndex({
				sourceStart: 450,
				sourceDuration: 900,
				mediaDuration: 30,
				sourceFps: 30
			})
		).toBe(15);
		expect(colorClipStartFrameIndex({ sourceStart: 179, sourceFps: 30 })).toBe(5);
		expect(colorClipStartFrameIndex({ sourceStart: -30, sourceFps: 30 })).toBe(0);
	});
});
