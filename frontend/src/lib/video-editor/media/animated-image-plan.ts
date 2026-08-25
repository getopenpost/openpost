/**
 * Pure planning math for animated GIF/WebP timeline items.
 *
 * Ported from FreeCut (MIT) - timeline/services/gif-frame-cache.ts
 * (cumulative-delay lookup) and clip-filmstrip/image-filmstrip.tsx (tile
 * geometry), retargeted to OpenPost's TimelineItem model.
 */

import type { MediaMetadata } from './types';

export type AnimatedImageFormat = 'gif' | 'webp';

/** GIF/WebP frames with a zero or missing delay display for 100ms (FreeCut parity). */
export const DEFAULT_ANIMATED_FRAME_DELAY_MS = 100;

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
 * The frame showing at `timeMs`, looping over the total animation duration.
 * Binary search on cumulative delays; time normalizes into [0, total).
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
	let low = 0;
	let high = frameCount - 1;
	while (low < high) {
		const middle = Math.floor((low + high + 1) / 2);
		if ((cumulativeDelaysMs[middle] ?? 0) <= normalized) low = middle;
		else high = middle - 1;
	}
	return low;
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

/**
 * Animation-clock milliseconds for a timeline frame. Clip time advances at the
 * item speed and loops over one full animation cycle; reversed clips read the
 * same clock backward.
 */
export function animatedImageTimeMs(input: AnimatedImageTimingInput): number {
	if (!(input.totalDurationMs > 0)) return 0;
	const localSeconds = Math.max(0, input.frame - input.fromFrame) / input.fps;
	const elapsedMs = localSeconds * (input.speed > 0 ? input.speed : 1) * 1000;
	const looped = elapsedMs % input.totalDurationMs;
	return input.reversed ? (input.totalDurationMs - looped) % input.totalDurationMs : looped;
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
		const localRatio = input.reversed ? 1 - centerRatio : centerRatio;
		const index = animatedFrameIndexAtTime(
			cumulativeDelaysMs,
			totalDurationMs,
			localRatio * input.clipSpanSeconds * (input.speed > 0 ? input.speed : 1) * 1000
		);
		tiles.push({ slot, index, x, width });
	}
	return tiles;
}
