/**
 * Ported from FreeCut (MIT) — timeline/services/filmstrip-cache-config.ts and
 * the pure target-planning helpers of filmstrip-cache.ts, plus
 * timeline/utils/fit-filmstrip-frame-size.ts.
 *
 * Filmstrips extract at 1 source frame per second; these helpers decide WHICH
 * seconds get extracted so a clip shows a bounded number of thumbnails no
 * matter its duration, with denser sampling near the playhead window.
 */

/** Frames (seconds) per filmstrip thumbnail — must match the extraction worker. */
export const FILMSTRIP_FRAME_RATE = 1;

/** Extraction pixel budget: thumbnails render at track height, extract larger for zoom headroom. */
export const FILMSTRIP_EXTRACT_HEIGHT = 100;
export const FILMSTRIP_EXTRACT_WIDTH = Math.round(FILMSTRIP_EXTRACT_HEIGHT * (16 / 9));

export const MIN_FILMSTRIP_TARGET_FRAMES = 40;
export const MAX_FILMSTRIP_TARGET_FRAMES = 72;
export const TARGET_FRAME_BUDGET_SCALE = 4;

export const BACKGROUND_STRIDE_MEDIUM = 2;
export const BACKGROUND_STRIDE_LONG = 3;
export const BACKGROUND_STRIDE_VERY_LONG = 4;
export const MEDIUM_CLIP_FRAME_THRESHOLD = 300;
export const LONG_CLIP_FRAME_THRESHOLD = 1200;
export const VERY_LONG_CLIP_FRAME_THRESHOLD = 2400;

export interface FrameRange {
	startIndex: number;
	endIndex: number;
}

function normalizeTargetFrameCount(targetFrameCount?: number | null): number | null {
	if (targetFrameCount == null) return null;
	if (!Number.isFinite(targetFrameCount) || targetFrameCount <= 0) return null;
	return Math.max(1, Math.ceil(targetFrameCount));
}

export interface FilmstripFrameSize {
	width: number;
	height: number;
}

/** Fits a filmstrip frame inside the budget without changing its aspect ratio. */
export function fitFilmstripFrameSize(
	sourceWidth: number,
	sourceHeight: number,
	maxWidth: number,
	maxHeight: number
): FilmstripFrameSize {
	if (sourceWidth <= 0 || sourceHeight <= 0) return { width: maxWidth, height: maxHeight };

	const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
	return {
		width: Math.max(1, Math.round(sourceWidth * scale)),
		height: Math.max(1, Math.round(sourceHeight * scale))
	};
}

/** Upper bound on thumbnails for a clip of `totalFrames` source seconds. */
export function getTargetFrameBudget(
	totalFrames: number,
	targetFrameCount?: number | null
): number {
	if (totalFrames <= 0) return 0;

	const normalizedTargetFrameCount = normalizeTargetFrameCount(targetFrameCount);

	const defaultBudget =
		totalFrames <= MIN_FILMSTRIP_TARGET_FRAMES
			? totalFrames
			: Math.max(
					MIN_FILMSTRIP_TARGET_FRAMES,
					Math.min(
						totalFrames,
						Math.min(
							MAX_FILMSTRIP_TARGET_FRAMES,
							Math.round(Math.sqrt(totalFrames) * TARGET_FRAME_BUDGET_SCALE)
						)
					)
				);

	if (normalizedTargetFrameCount === null) {
		return defaultBudget;
	}

	return Math.max(1, Math.min(totalFrames, Math.min(defaultBudget, normalizedTargetFrameCount)));
}

/** Duration-based stride for sampling the non-priority tail of long clips. */
export function getBackgroundStride(totalFrames: number): number {
	if (totalFrames <= MEDIUM_CLIP_FRAME_THRESHOLD) return 1;
	if (totalFrames <= LONG_CLIP_FRAME_THRESHOLD) return BACKGROUND_STRIDE_MEDIUM;
	if (totalFrames <= VERY_LONG_CLIP_FRAME_THRESHOLD) return BACKGROUND_STRIDE_LONG;
	return BACKGROUND_STRIDE_VERY_LONG;
}

/**
 * Which frame indices to extract: always the first and last second, dense
 * inside the priority range (the visible window), then adaptive stride
 * sampling of the remainder within the budget.
 */
export function buildTargetIndices(
	totalFrames: number,
	priorityRange: FrameRange | null,
	targetFrameCount?: number | null,
	exactTargetIndices?: readonly number[] | null
): number[] {
	if (totalFrames <= 0) return [];

	const target = new Set<number>();
	target.add(0);
	target.add(totalFrames - 1);

	for (const index of buildPriorityIndices(totalFrames, priorityRange)) {
		target.add(index);
	}
	for (const index of exactTargetIndices ?? []) {
		if (Number.isInteger(index) && index >= 0 && index < totalFrames) target.add(index);
	}

	if (totalFrames <= MIN_FILMSTRIP_TARGET_FRAMES) {
		for (let i = 0; i < totalFrames; i++) target.add(i);
		return [...target].sort((a, b) => a - b);
	}

	const budget = getTargetFrameBudget(totalFrames, targetFrameCount);
	if (budget >= totalFrames) {
		for (let i = 0; i < totalFrames; i++) target.add(i);
		return [...target].sort((a, b) => a - b);
	}

	const stride = getBackgroundStride(totalFrames);
	const backgroundCandidates: number[] = [];
	for (let i = 0; i < totalFrames; i += stride) {
		if (!target.has(i)) backgroundCandidates.push(i);
	}

	const remainingBudget = Math.max(0, budget - target.size);
	if (remainingBudget === 0 || backgroundCandidates.length === 0) {
		return [...target].sort((a, b) => a - b);
	}

	if (backgroundCandidates.length <= remainingBudget) {
		for (const index of backgroundCandidates) target.add(index);
	} else {
		const step = backgroundCandidates.length / remainingBudget;
		for (let i = 0; i < remainingBudget; i++) {
			const outsideIndex = Math.floor(i * step);
			const chosen = backgroundCandidates[Math.min(backgroundCandidates.length - 1, outsideIndex)];
			if (chosen !== undefined) target.add(chosen);
		}
	}

	return [...target].sort((a, b) => a - b);
}

/** Keep the planned set intact while moving visible viewport frames to the decode front. */
export function prioritizeFilmstripTargetIndices(
	planned: readonly number[],
	priority: readonly number[] | null | undefined
): number[] {
	if (!priority?.length) return [...planned];
	const plannedSet = new Set(planned);
	const ordered: number[] = [];
	const seen = new Set<number>();
	for (const index of priority) {
		if (!plannedSet.has(index) || seen.has(index)) continue;
		seen.add(index);
		ordered.push(index);
	}
	for (const index of planned) {
		if (seen.has(index)) continue;
		seen.add(index);
		ordered.push(index);
	}
	return ordered;
}

/**
 * Dense (capped) indices for the priority range — the window around the
 * playhead or viewport that should fill in first.
 */
export function buildPriorityIndices(
	totalFrames: number,
	priorityRange: FrameRange | null,
	maxPriorityDenseFrames = 180
): number[] {
	if (!priorityRange || totalFrames <= 0) return [];

	const rangeStart = Math.max(0, Math.min(totalFrames - 1, priorityRange.startIndex));
	const rangeEnd = Math.max(rangeStart + 1, Math.min(totalFrames, priorityRange.endIndex));
	const rangeLength = Math.max(0, rangeEnd - rangeStart);
	if (rangeLength === 0) return [];

	if (rangeLength <= maxPriorityDenseFrames) {
		const dense: number[] = [];
		for (let i = rangeStart; i < rangeEnd; i++) dense.push(i);
		return dense;
	}

	const sampled = new Set<number>();
	const stride = Math.ceil(rangeLength / maxPriorityDenseFrames);
	for (let i = rangeStart; i < rangeEnd; i += stride) sampled.add(i);
	sampled.add(rangeStart);
	sampled.add(rangeEnd - 1);
	return [...sampled].sort((a, b) => a - b);
}

export interface FilmstripFrameRef {
	index: number;
	url: string | null;
}

export interface FilmstripTile {
	slot: number;
	index: number;
	url: string | null;
	x: number;
	width: number;
}

export interface FilmstripTileWindow {
	tileWidthPx: number;
	visibleStartPx?: number;
	visibleEndPx?: number;
	/** Exact source mapping for variable-speed or otherwise non-linear playback. */
	sourceSecondAtTimelineRatio?: (timelineRatio: number) => number;
}

/**
 * Layout filmstrip frames across a clip. The viewport mode fills stable display
 * slots with the nearest decoded frame; the legacy mode keeps exact one-second
 * geometry for callers that need source-time tiles.
 */
export function computeFilmstripTiles(
	frames: readonly FilmstripFrameRef[],
	sourceStartSeconds: number,
	clipSpanSeconds: number,
	clipWidthPx: number,
	reversed = false,
	window?: FilmstripTileWindow
): FilmstripTile[] {
	if (!(clipSpanSeconds > 0) || !(clipWidthPx > 0) || frames.length === 0) return [];

	if (window) {
		const tileWidth = Math.max(1, window.tileWidthPx);
		const visibleStart = Math.max(0, Math.min(clipWidthPx, window.visibleStartPx ?? 0));
		const visibleEnd = Math.max(
			visibleStart,
			Math.min(clipWidthPx, window.visibleEndPx ?? clipWidthPx)
		);
		if (visibleEnd <= visibleStart) return [];

		const sortedFrames = [...frames].toSorted((left, right) => left.index - right.index);
		const firstSlot = Math.floor(visibleStart / tileWidth);
		const lastSlot = Math.ceil(visibleEnd / tileWidth);
		const tiles: FilmstripTile[] = [];
		for (let slot = firstSlot; slot < lastSlot; slot++) {
			const x = slot * tileWidth;
			const width = Math.min(tileWidth, clipWidthPx - x);
			if (width <= 0) continue;
			const centerRatio = Math.max(0, Math.min(1, (x + width / 2) / clipWidthPx));
			const sourceSecond = window.sourceSecondAtTimelineRatio
				? window.sourceSecondAtTimelineRatio(centerRatio)
				: reversed
					? sourceStartSeconds + clipSpanSeconds * (1 - centerRatio)
					: sourceStartSeconds + clipSpanSeconds * centerRatio;
			const frame = nearestFilmstripFrame(sortedFrames, sourceSecond);
			tiles.push({ slot, index: frame.index, url: frame.url, x, width });
		}
		return tiles;
	}

	const pxPerSecond = clipWidthPx / clipSpanSeconds;
	const endSeconds = sourceStartSeconds + clipSpanSeconds;
	const tiles: FilmstripTile[] = [];

	for (const frame of frames) {
		const visibleStart = Math.max(frame.index, sourceStartSeconds);
		const visibleEnd = Math.min(frame.index + 1, endSeconds);
		const span = visibleEnd - visibleStart;
		if (span <= 0) continue;
		const x = (visibleStart - sourceStartSeconds) * pxPerSecond;
		tiles.push({
			slot: frame.index,
			index: frame.index,
			url: frame.url,
			x: reversed ? clipWidthPx - x - span * pxPerSecond : x,
			width: span * pxPerSecond
		});
	}

	return tiles.toSorted((left, right) => left.x - right.x);
}

function nearestFilmstripFrame(
	frames: readonly FilmstripFrameRef[],
	targetSecond: number
): FilmstripFrameRef {
	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		const current = frames[middle];
		if (!current || current.index < targetSecond) low = middle + 1;
		else high = middle;
	}
	const after = frames[low] ?? frames[frames.length - 1]!;
	const before = frames[Math.max(0, low - 1)] ?? after;
	return Math.abs(before.index - targetSecond) <= Math.abs(after.index - targetSecond)
		? before
		: after;
}

export interface VisibleFilmstripTargetsInput {
	sourceStartSeconds: number;
	clipSpanSeconds: number;
	clipWidthPx: number;
	visibleStartPx: number;
	visibleEndPx: number;
	tileWidthPx: number;
	totalSourceFrames: number;
	reversed?: boolean;
	/** Exact source mapping for variable-speed or otherwise non-linear playback. */
	sourceSecondAtTimelineRatio?: (timelineRatio: number) => number;
}

/** Exact 1 fps source frames needed to fill the visible timeline tile window. */
export function visibleFilmstripTargetIndices(input: VisibleFilmstripTargetsInput): number[] {
	if (
		!(input.clipSpanSeconds > 0) ||
		!(input.clipWidthPx > 0) ||
		!(input.tileWidthPx > 0) ||
		input.totalSourceFrames <= 0
	) {
		return [];
	}
	const visibleStart = Math.max(0, Math.min(input.clipWidthPx, input.visibleStartPx));
	const visibleEnd = Math.max(visibleStart, Math.min(input.clipWidthPx, input.visibleEndPx));
	if (visibleEnd <= visibleStart) return [];

	const indices = new Set<number>();
	const firstSlot = Math.floor(visibleStart / input.tileWidthPx);
	const lastSlot = Math.ceil(visibleEnd / input.tileWidthPx);
	for (let slot = firstSlot; slot < lastSlot; slot++) {
		const x = slot * input.tileWidthPx;
		const width = Math.min(input.tileWidthPx, input.clipWidthPx - x);
		if (width <= 0) continue;
		const centerRatio = Math.max(0, Math.min(1, (x + width / 2) / input.clipWidthPx));
		const sourceSecond = input.sourceSecondAtTimelineRatio
			? input.sourceSecondAtTimelineRatio(centerRatio)
			: input.reversed
				? input.sourceStartSeconds + input.clipSpanSeconds * (1 - centerRatio)
				: input.sourceStartSeconds + input.clipSpanSeconds * centerRatio;
		indices.add(Math.max(0, Math.min(input.totalSourceFrames - 1, Math.floor(sourceSecond))));
	}
	return [...indices].toSorted((left, right) => left - right);
}
