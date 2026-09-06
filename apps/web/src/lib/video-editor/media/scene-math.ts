/**
 * Pure math for scene-cut scanning: frame-grid histogram building and
 * cut-position mapping. Kept free of mediabunny/DOM types so it can be
 * unit-tested directly.
 *
 * Ported from FreeCut (MIT) — scene-sampling concept: downscale sampled
 * frames and compare average-luma grids between consecutive samples.
 */

import type { FrameHistogram } from './scene-detection';

/** Seconds between sampled frames (~4 fps). */
export const SCENE_SAMPLE_INTERVAL_SECONDS = 0.25;

export const SCENE_GRID_WIDTH = 32;
export const SCENE_GRID_HEIGHT = 18;
export const SCENE_HISTOGRAM_BINS = 32;

/**
 * Build normalized RGB histograms from one downscaled RGBA frame. Each
 * channel occupies its own bucket range and sums to 1, preserving color
 * changes that a normalized luma grid loses on uniform shots.
 */
export function rgbHistogram(
	pixels: Uint8ClampedArray,
	width: number,
	height: number
): FrameHistogram['buckets'] {
	const pixelCount = width * height;
	const buckets = new Array<number>(SCENE_HISTOGRAM_BINS * 3).fill(0);
	if (pixelCount <= 0) return buckets;
	const binScale = SCENE_HISTOGRAM_BINS / 256;
	for (let index = 0; index < pixels.length; index += 4) {
		for (let channel = 0; channel < 3; channel += 1) {
			const bin = Math.min(
				SCENE_HISTOGRAM_BINS - 1,
				Math.floor(pixels[index + channel]! * binScale)
			);
			buckets[channel * SCENE_HISTOGRAM_BINS + bin]! += 1;
		}
	}
	return buckets.map((value) => value / pixelCount);
}

export interface CutFrameMapping {
	/** Cut positions in the media's own source frames. */
	cutSourceFrames: number[];
	sourceFps: number;
	sourceStart?: number;
	speed?: number;
	from: number;
	timelineFps: number;
}

/**
 * Map source-frame cut positions onto timeline frames within one item,
 * inverting the same source-window math `_splitItem` uses when it shifts
 * the right piece.
 */
export function cutFramesForItem(mapping: CutFrameMapping): number[] {
	const speed = mapping.speed && mapping.speed > 0 ? mapping.speed : 1;
	const sourceFps = mapping.sourceFps > 0 ? mapping.sourceFps : mapping.timelineFps;
	const sourceStart = mapping.sourceStart ?? 0;
	return mapping.cutSourceFrames.map(
		(sourceFrame) =>
			mapping.from +
			Math.round(((sourceFrame - sourceStart) / sourceFps / speed) * mapping.timelineFps)
	);
}
