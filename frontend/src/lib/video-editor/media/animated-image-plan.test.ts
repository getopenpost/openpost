import { describe, expect, it } from 'vitest';
import {
	animatedFrameIndexAtElapsed,
	animatedFrameIndexAtTime,
	animatedFrameIndexForItem,
	animatedImageElapsedMs,
	animatedImageFormat,
	computeAnimatedImageTiles,
	computeCumulativeDelays,
	isAnimatedImageMedia
} from './animated-image-plan';

describe('animatedImageFormat', () => {
	it('detects gif and webp by mime type', () => {
		expect(animatedImageFormat({ mimeType: 'image/gif', fileName: 'a' })).toBe('gif');
		expect(animatedImageFormat({ mimeType: 'image/webp', fileName: 'a' })).toBe('webp');
		expect(animatedImageFormat({ mimeType: 'image/png', fileName: 'a.gif' })).toBeNull();
	});

	it('falls back to the file extension for generic mime types', () => {
		expect(animatedImageFormat({ mimeType: '', fileName: 'loop.GIF' })).toBe('gif');
		expect(animatedImageFormat({ mimeType: 'binary/octet-stream', fileName: 'x.webp' })).toBe(
			'webp'
		);
		expect(animatedImageFormat({ mimeType: '', fileName: 'x.txt' })).toBeNull();
	});
});

describe('isAnimatedImageMedia', () => {
	it('requires the image tag and a real frame count', () => {
		expect(isAnimatedImageMedia({ tags: ['image'], animationFrameCount: 3 })).toBe(true);
		expect(isAnimatedImageMedia({ tags: ['image'], animationFrameCount: 1 })).toBe(false);
		expect(isAnimatedImageMedia({ tags: ['video'], animationFrameCount: 3 })).toBe(false);
		expect(isAnimatedImageMedia(undefined)).toBe(false);
	});
});

describe('computeCumulativeDelays + animatedFrameIndexAtTime', () => {
	const durations = [100, 50, 100];
	const cumulative = computeCumulativeDelays(durations);

	it('builds leading-zero cumulative boundaries', () => {
		expect(cumulative).toEqual([0, 100, 150, 250]);
	});

	it('maps times inside each frame window', () => {
		expect(animatedFrameIndexAtTime(cumulative, 250, 0)).toBe(0);
		expect(animatedFrameIndexAtTime(cumulative, 250, 99.9)).toBe(0);
		expect(animatedFrameIndexAtTime(cumulative, 250, 100)).toBe(1);
		expect(animatedFrameIndexAtTime(cumulative, 250, 149)).toBe(1);
		expect(animatedFrameIndexAtTime(cumulative, 250, 150)).toBe(2);
	});

	it('loops and normalizes negative time', () => {
		expect(animatedFrameIndexAtTime(cumulative, 250, 250)).toBe(0);
		expect(animatedFrameIndexAtTime(cumulative, 250, 260)).toBe(0);
		expect(animatedFrameIndexAtTime(cumulative, 250, -100)).toBe(2);
	});

	it('degrades to the first frame when there is no duration', () => {
		expect(animatedFrameIndexAtTime([0], 0, 500)).toBe(0);
	});
});

describe('animatedFrameIndexAtElapsed reverse exclusive-end', () => {
	// durations [100,100,100] -> cumulative [0,100,200,300] total 300
	const cumulative = computeCumulativeDelays([100, 100, 100]);

	it('forward reads from 0 inclusive', () => {
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 0,
				reversed: false,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(0);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 100,
				reversed: false,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(1);
	});

	it('reversed reads exclusive end so elapsed 0 is last frame', () => {
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 0,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(2);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 1,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(2);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 100,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(1);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 200,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(0);
	});

	it('reversed loops without freezing on first frame', () => {
		// elapsed 0 and elapsed 300 both map to last frame via exclusive end
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 300,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(2);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 301,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(2);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 400,
				reversed: true,
				cumulativeDelaysMs: cumulative,
				totalDurationMs: 300
			})
		).toBe(1);
	});

	it('handles zero duration gracefully', () => {
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 0,
				reversed: true,
				cumulativeDelaysMs: [0],
				totalDurationMs: 0
			})
		).toBe(0);
	});
});

describe('animatedImageElapsedMs + animatedFrameIndexForItem', () => {
	it('advances with timeline time at item speed', () => {
		expect(
			animatedImageElapsedMs({
				frame: 30,
				fromFrame: 0,
				fps: 30,
				speed: 1,
				reversed: false,
				totalDurationMs: 3000
			})
		).toBe(1000);
		expect(
			animatedImageElapsedMs({
				frame: 30,
				fromFrame: 0,
				fps: 30,
				speed: 2,
				reversed: false,
				totalDurationMs: 3000
			})
		).toBe(2000);
	});

	it('loops over one animation cycle for forward', () => {
		expect(
			animatedImageElapsedMs({
				frame: 90,
				fromFrame: 0,
				fps: 30,
				speed: 1,
				reversed: false,
				totalDurationMs: 1000
			})
		).toBe(0);
		expect(
			animatedImageElapsedMs({
				frame: 105,
				fromFrame: 0,
				fps: 30,
				speed: 1,
				reversed: false,
				totalDurationMs: 1000
			})
		).toBe(500);
	});

	it('reversed elapsed grows unbounded, frame lookup wraps via exclusive end', () => {
		// 3 frames of 100ms each, fps 30, from 0
		const cumulative = computeCumulativeDelays([100, 100, 100]);
		// frame 0 reversed -> elapsed 0 -> last frame 2
		expect(
			animatedFrameIndexForItem({
				frame: 0,
				fromFrame: 0,
				fps: 30,
				speed: 1,
				reversed: true,
				totalDurationMs: 300,
				cumulativeDelaysMs: cumulative
			})
		).toBe(2);
		// frame 3 = 100ms elapsed reversed -> mirrored 200 -> frame 1
		expect(
			animatedFrameIndexForItem({
				frame: 3,
				fromFrame: 0,
				fps: 30,
				speed: 1,
				reversed: true,
				totalDurationMs: 300,
				cumulativeDelaysMs: cumulative
			})
		).toBe(1);
		// frame 9 = 300ms elapsed reversed -> loop -> last frame again, not first
		expect(
			animatedFrameIndexForItem({
				frame: 9,
				fromFrame: 0,
				fps: 30,
				speed: 1,
				reversed: true,
				totalDurationMs: 300,
				cumulativeDelaysMs: cumulative
			})
		).toBe(2);
	});
});

describe('computeAnimatedImageTiles', () => {
	// 800ms cycle across a 1.6s clip: tile centers land on 200/600/200/600ms,
	// so the strip alternates between the two animation frames.
	const durations = [400, 400];
	const cumulative = computeCumulativeDelays(durations);

	function plan(visibleStartPx: number, visibleEndPx: number, clipWidthPx = 400) {
		return computeAnimatedImageTiles({
			cumulativeDelaysMs: cumulative,
			totalDurationMs: 800,
			clipSpanSeconds: 1.6,
			speed: 1,
			reversed: false,
			clipWidthPx,
			tileWidthPx: 100,
			visibleStartPx,
			visibleEndPx
		});
	}

	it('tiles the full clip with frames sampled at tile centers', () => {
		const tiles = plan(0, 400);
		expect(tiles.map((tile) => tile.slot)).toEqual([0, 1, 2, 3]);
		expect(tiles[0]).toMatchObject({ index: 0, x: 0, width: 100 });
		expect(tiles[1]).toMatchObject({ index: 1, x: 100, width: 100 });
		expect(tiles[2]).toMatchObject({ index: 0, x: 200, width: 100 });
		expect(tiles[3]).toMatchObject({ index: 1, x: 300, width: 100 });
	});

	it('honors the visible window', () => {
		expect(plan(120, 280).map((tile) => tile.slot)).toEqual([1, 2]);
	});

	it('flips sampling for reversed clips (exclusive-end)', () => {
		const reversed = computeAnimatedImageTiles({
			cumulativeDelaysMs: cumulative,
			totalDurationMs: 800,
			clipSpanSeconds: 1.6,
			speed: 1,
			reversed: true,
			clipWidthPx: 400,
			tileWidthPx: 100,
			visibleStartPx: 0,
			visibleEndPx: 400
		});
		// centers 200/600/1000/1400ms forward -> 0,1,0,1 ; reversed exclusive -> 1,0,1,0
		expect(reversed.map((tile) => tile.index)).toEqual([1, 0, 1, 0]);
	});

	it('returns nothing without usable inputs', () => {
		expect(
			computeAnimatedImageTiles({
				cumulativeDelaysMs: [0],
				totalDurationMs: 0,
				clipSpanSeconds: 4,
				speed: 1,
				reversed: false,
				clipWidthPx: 400,
				tileWidthPx: 100,
				visibleStartPx: 0,
				visibleEndPx: 400
			})
		).toEqual([]);
	});
});
