import { describe, expect, it } from 'vitest';
import {
	panTimelineViewport,
	revealTimelineTime,
	timelineTimeAtFraction,
	visibleTimelineDuration,
	zoomTimelineViewport
} from './timeline-viewport';

describe('Quick Cut timeline viewport', () => {
	it('zooms around the pointer without changing the time beneath it', () => {
		const before = { start: 20, zoom: 2 };
		const anchorBefore = timelineTimeAtFraction(before, 100, 0.75);
		const after = zoomTimelineViewport(before, 100, 5, 0.75);

		expect(timelineTimeAtFraction(after, 100, 0.75)).toBeCloseTo(anchorBefore);
		expect(after).toEqual({ start: 42.5, zoom: 5 });
	});

	it('pans by the same fraction of the visible window and clamps at both ends', () => {
		expect(panTimelineViewport({ start: 20, zoom: 4 }, 100, 200, 1000)).toEqual({
			start: 25,
			zoom: 4
		});
		expect(panTimelineViewport({ start: 70, zoom: 4 }, 100, 1000, 1000)).toEqual({
			start: 75,
			zoom: 4
		});
	});

	it('reveals playback outside the window while keeping a leading edge margin', () => {
		const viewport = revealTimelineTime({ start: 0, zoom: 5 }, 100, 60);
		expect(visibleTimelineDuration(100, viewport.zoom)).toBe(20);
		expect(viewport).toEqual({ start: 42, zoom: 5 });
	});
});
