import { describe, expect, it } from 'vitest';
import { SCENE_HISTOGRAM_BINS, cutFramesForItem, rgbHistogram } from './scene-math';

function solidRgba(
	width: number,
	height: number,
	r: number,
	g: number,
	b: number
): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		pixels[i * 4] = r;
		pixels[i * 4 + 1] = g;
		pixels[i * 4 + 2] = b;
		pixels[i * 4 + 3] = 255;
	}
	return pixels;
}

describe('rgbHistogram', () => {
	it('normalizes each color channel independently', () => {
		const buckets = rgbHistogram(solidRgba(32, 18, 128, 128, 128), 32, 18);
		expect(buckets.length).toBe(SCENE_HISTOGRAM_BINS * 3);
		for (let channel = 0; channel < 3; channel += 1) {
			const start = channel * SCENE_HISTOGRAM_BINS;
			const total = buckets
				.slice(start, start + SCENE_HISTOGRAM_BINS)
				.reduce((sum, value) => sum + value, 0);
			expect(total).toBeCloseTo(1, 6);
		}
	});

	it('keeps uniform red and blue frames distinct', () => {
		const red = rgbHistogram(solidRgba(32, 18, 255, 0, 0), 32, 18);
		const blue = rgbHistogram(solidRgba(32, 18, 0, 0, 255), 32, 18);
		expect(red).not.toEqual(blue);
	});
});

describe('cutFramesForItem', () => {
	it('maps source frames onto timeline positions', () => {
		const frames = cutFramesForItem({
			cutSourceFrames: [30, 90],
			sourceFps: 30,
			from: 100,
			timelineFps: 30
		});
		expect(frames).toEqual([130, 190]);
	});

	it('accounts for source offset and playback speed', () => {
		const frames = cutFramesForItem({
			cutSourceFrames: [60],
			sourceFps: 30,
			sourceStart: 30,
			speed: 2,
			from: 50,
			timelineFps: 30
		});
		// 1s of source (frames 30→60) plays in 0.5s at 2× — 15 timeline frames.
		expect(frames).toEqual([65]);
	});

	it('falls back to the timeline fps when the source fps is unusable', () => {
		const frames = cutFramesForItem({
			cutSourceFrames: [10],
			sourceFps: 0,
			from: 0,
			timelineFps: 20
		});
		expect(frames).toEqual([10]);
	});
});
