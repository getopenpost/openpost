/**
 * Pure planning math for animated GIF/WebP timeline items.
 *
 * Ported from FreeCut (MIT) - timeline/services/gif-frame-cache.ts
 * (cumulative-delay lookup) and clip-filmstrip/image-filmstrip.tsx (tile
 * geometry), retargeted to OpenPost's TimelineItem model.
 */

import type { MediaMetadata } from './types';

export type AnimatedImageFormat = 'gif' | 'webp';

export function animatedImageFormat(media: {
	mimeType: string;
	fileName: string;
}): AnimatedImageFormat | null {
	const mime = media.mimeType.toLowerCase();
	if (mime === 'image/gif') return 'gif';
	if (mime === 'image/webp') return 'webp';
	if (mime !== '' && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') {
		return null;
	}
	const name = media.fileName.toLowerCase();
	if (name.endsWith('.gif')) return 'gif';
	if (name.endsWith('.webp')) return 'webp';
	return null;
}

/** True for image-pool media that carries a real multi-frame animation. */
export function isAnimatedImageMedia(
	media: Pick<MediaMetadata, 'tags' | 'animationFrameCount'> | undefined
): boolean {
	return !!media && media.tags.includes('image') === true && (media.animationFrameCount ?? 0) > 1;
}

/**
 * Cumulative delay boundaries in milliseconds: durations [100, 50, 100] map to
 * [0, 100, 150, 250], so frame i covers [cumulative[i], cumulative[i+1]).
 */
export function computeCumulativeDelays(durationsMs: readonly number[]): number[] {
	const cumulative = [0];
	let sum = 0;
	for (const duration of durationsMs) {
		sum += duration;
		cumulative.push(sum);
	}
	return cumulative;
}

/**
 * The frame covering `timeMs` in a forward loop over the total animation
 * duration. Binary search on cumulative delays; time normalizes into
 * [0, total).
 */
export function animatedFrameIndexAtTime(
	cumulativeDelaysMs: readonly number[],
	totalDurationMs: number,
	timeMs: number
): number {
	const frameCount = cumulativeDelaysMs.length - 1;
	if (frameCount <= 0) return 0;
	const normalized =
		totalDurationMs > 0 ? ((timeMs % totalDurationMs) + totalDurationMs) % totalDurationMs : 0;
	return lastIndexAtOrBefore(cumulativeDelaysMs, normalized);
}

function lastIndexAtOrBefore(cumulativeDelaysMs: readonly number[], timeMs: number): number {
	let low = 0;
	let high = cumulativeDelaysMs.length - 2;
	while (low < high) {
		const middle = Math.floor((low + high + 1) / 2);
		if ((cumulativeDelaysMs[middle] ?? 0) <= timeMs) low = middle;
		else high = middle - 1;
	}
	return low;
}

function lastIndexStrictlyBefore(cumulativeDelaysMs: readonly number[], timeMs: number): number {
	// SAFETY: callers guarantee timeMs > 0, so the result is a valid index.
	let low = 0;
	let high = cumulativeDelaysMs.length - 2;
	while (low < high) {
		const middle = Math.floor((low + high + 1) / 2);
		if ((cumulativeDelaysMs[middle] ?? 0) < timeMs) low = middle;
		else high = middle - 1;
	}
	return low;
}

export interface AnimatedFrameLookupInput {
	/** Elapsed clip milliseconds (timeline position already scaled by speed). */
	elapsedMs: number;
	reversed: boolean;
	cumulativeDelaysMs: readonly number[];
	totalDurationMs: number;
}

/**
 * The animation frame showing after `elapsedMs` of playback. Forward reads the
 * loop clock [0, total); reversed reads the same clock backward from the
 * EXCLUSIVE end, so elapsed 0 shows the final frame and each cycle restarts on
 * the last frame instead of freezing on the first.
 */
export function animatedFrameIndexAtElapsed(input: AnimatedFrameLookupInput): number {
	const { cumulativeDelaysMs, totalDurationMs } = input;
	if (cumulativeDelaysMs.length <= 1 || !(totalDurationMs > 0)) return 0;
	const looped = Math.max(0, input.elapsedMs) % totalDurationMs;
	if (!input.reversed) return lastIndexAtOrBefore(cumulativeDelaysMs, looped);
	const mirrored = looped === 0 ? totalDurationMs : totalDurationMs - looped;
	return lastIndexStrictlyBefore(cumulativeDelaysMs, mirrored);
}

export interface AnimatedImageTimingInput {
	/** Absolute timeline frame. */
	frame: number;
	/** First frame of the timeline item. */
	fromFrame: number;
	/** Project frames per second. */
	fps: number;
	/** Item playback speed multiplier. */
	speed: number;
	/** Play the animation loop backward while timeline time moves forward. */
	reversed: boolean;
	totalDurationMs: number;
}

/** Elapsed animation-clock milliseconds for a timeline frame (forward loop). */
export function animatedImageElapsedMs(input: AnimatedImageTimingInput): number {
	if (!(input.totalDurationMs > 0)) return 0;
	const localSeconds = Math.max(0, input.frame - input.fromFrame) / input.fps;
	const elapsedMs = localSeconds * (input.speed > 0 ? input.speed : 1) * 1000;
	return input.reversed ? elapsedMs : elapsedMs % input.totalDurationMs;
}

/** @deprecated Use animatedImageElapsedMs. Kept for tests that still import the old name. */
export const animatedImageTimeMs = animatedImageElapsedMs;

/** The decoded frame index a timeline frame must show for one clip. */
export function animatedFrameIndexForItem(
	input: AnimatedImageTimingInput & { cumulativeDelaysMs: readonly number[] }
): number {
	return animatedFrameIndexAtElapsed({
		elapsedMs: animatedImageElapsedMs(input),
		reversed: input.reversed,
		cumulativeDelaysMs: input.cumulativeDelaysMs,
		totalDurationMs: input.totalDurationMs
	});
}

export interface AnimatedImageTile {
	slot: number;
	index: number;
	x: number;
	width: number;
}

export interface AnimatedTilePlanInput {
	cumulativeDelaysMs: readonly number[];
	totalDurationMs: number;
	/** Timeline seconds the item spans at its own speed (durationInFrames / fps). */
	clipSpanSeconds: number;
	speed: number;
	reversed: boolean;
	clipWidthPx: number;
	tileWidthPx: number;
	visibleStartPx: number;
	visibleEndPx: number;
}

/**
 * Timeline filmstrip tiles for one animated image clip. Each tile samples its
 * center pixel through the speed/reverse-aware animation clock so the strip
 * shows the exact frame playing under it.
 */
export function computeAnimatedImageTiles(input: AnimatedTilePlanInput): AnimatedImageTile[] {
	const { cumulativeDelaysMs, totalDurationMs } = input;
	if (
		cumulativeDelaysMs.length <= 1 ||
		!(totalDurationMs > 0) ||
		!(input.clipSpanSeconds > 0) ||
		!(input.clipWidthPx > 0) ||
		!(input.tileWidthPx > 0)
	) {
		return [];
	}
	const visibleStart = Math.max(0, Math.min(input.clipWidthPx, input.visibleStartPx));
	const visibleEnd = Math.max(visibleStart, Math.min(input.clipWidthPx, input.visibleEndPx));
	if (visibleEnd <= visibleStart) return [];

	const tiles: AnimatedImageTile[] = [];
	const firstSlot = Math.floor(visibleStart / input.tileWidthPx);
	const lastSlot = Math.ceil(visibleEnd / input.tileWidthPx);
	for (let slot = firstSlot; slot < lastSlot; slot++) {
		const x = slot * input.tileWidthPx;
		const width = Math.min(input.tileWidthPx, input.clipWidthPx - x);
		if (width <= 0) continue;
		const centerRatio = Math.max(0, Math.min(1, (x + width / 2) / input.clipWidthPx));
		const index = animatedFrameIndexAtElapsed({
			elapsedMs: centerRatio * input.clipSpanSeconds * (input.speed > 0 ? input.speed : 1) * 1000,
			reversed: input.reversed,
			cumulativeDelaysMs,
			totalDurationMs
		});
		tiles.push({ slot, index, x, width });
	}
	return tiles;
}
