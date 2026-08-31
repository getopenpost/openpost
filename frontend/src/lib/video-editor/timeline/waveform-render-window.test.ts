import { describe, expect, it } from 'vitest';
import {
	mappedTimelineWaveformSourceBoundaries,
	planTimelineWaveformRenderWindow,
	waveformPolyline
} from './waveform-render-window';

describe('timeline waveform render window', () => {
	it('keeps a multi-hour clip proportional to the viewport', () => {
		const window = planTimelineWaveformRenderWindow({
			clipFromFrame: 0,
			clipDurationFrames: 3 * 60 * 60 * 30,
			sourceStartFrame: 0,
			sourceEndFrame: 3 * 60 * 60 * 30,
			pixelsPerFrame: 4,
			scrollLeft: 500_000,
			viewportWidth: 1_280,
			headerWidth: 180,
			reversed: false
		});

		expect(window).toMatchObject({
			clipWidthPx: 1_296_000,
			leftPx: 499_328,
			widthPx: 2_432,
			startSourceFrame: 124_832,
			endSourceFrame: 125_440,
			reverseColumns: false
		});
	});

	it('maps a trimmed reverse clip to the exact ascending source window', () => {
		const window = planTimelineWaveformRenderWindow({
			clipFromFrame: 50,
			clipDurationFrames: 600,
			sourceStartFrame: 300,
			sourceEndFrame: 900,
			pixelsPerFrame: 1,
			scrollLeft: 250,
			viewportWidth: 200,
			headerWidth: 100,
			reversed: true,
			overscanPx: 0
		});

		expect(window).toMatchObject({
			leftPx: 200,
			widthPx: 100,
			startSourceFrame: 600,
			endSourceFrame: 700,
			reverseColumns: true
		});
	});

	it('centers symmetric peaks inside the view box', () => {
		expect(waveformPolyline(Float32Array.from([-1, 1, -0.5, 0.5]))).toBe(
			'0.5,0.0 0.5,80.0 1.5,20.0 1.5,60.0'
		);
	});

	it('maps only rendered waveform columns through the source-time curve', () => {
		const boundaries = mappedTimelineWaveformSourceBoundaries({
			window: { clipWidthPx: 600, leftPx: 200, widthPx: 100 },
			clipDurationFrames: 600,
			sourceFrameAtTimelineOffset: (timelineOffset) => timelineOffset * 2
		});

		expect(boundaries).toHaveLength(101);
		expect(boundaries[0]).toBe(400);
		expect(boundaries.at(-1)).toBe(600);
	});
});
