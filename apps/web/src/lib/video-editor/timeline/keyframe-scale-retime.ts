/**
 * Framework-free proportional (scale) retime planning for dope-sheet selections.
 *
 * While `keyframe-dopesheet.ts` moves selections by one shared delta, this module
 * stretches or compresses them around an anchor frame: each movable keyframe maps
 * to `anchor + (frame - anchor) * scale`, preserving easing and values because
 * only frames change. FreeCut parity: `keyframe-timing-strip` edge drags that
 * scale a multi-key selection in time (MIT; ported math, Svelte UI here).
 */

import type { KeyframeProperty } from '$lib/video-editor/project/types';
import type { BlockedFrameRange } from './keyframe-dopesheet';
import { keyframeIdentity, type EditorKeyframe } from './keyframe-editor';

export interface ScaleRetimePreview {
	frames: ReadonlyMap<string, number>;
	appliedScale: number;
}

const BISECTION_STEPS = 32;

/**
 * Convert a timing-strip edge drag into a requested scale factor.
 * `anchorFrame` is the held edge, `farFrame` the dragged edge before the
 * gesture and `farFrameNew` after it. Returns 1 when the span is degenerate.
 */
export function scaleRatioFromEdge({
	anchorFrame,
	farFrame,
	farFrameNew
}: {
	anchorFrame: number;
	farFrame: number;
	farFrameNew: number;
}): number {
	const span = farFrame - anchorFrame;
	if (!Number.isFinite(span) || span === 0) return 1;
	const next = farFrameNew - anchorFrame;
	const ratio = next / span;
	if (!Number.isFinite(ratio) || ratio <= 0) return 1;
	return Math.max(0.02, Math.min(50, ratio));
}

export function buildScaleRetimePreview({
	keyframes,
	selectionIds,
	lockedProperties,
	anchorFrame,
	requestedScale,
	totalFrames,
	blockedRanges
}: {
	keyframes: readonly EditorKeyframe[];
	selectionIds: ReadonlySet<string>;
	lockedProperties: ReadonlySet<KeyframeProperty>;
	anchorFrame: number;
	requestedScale: number;
	totalFrames: number;
	blockedRanges: readonly BlockedFrameRange[];
}): ScaleRetimePreview {
	const movable = keyframes.filter(
		(keyframe) =>
			selectionIds.has(keyframeIdentity(keyframe)) && !lockedProperties.has(keyframe.property)
	);
	if (movable.length === 0 || !Number.isFinite(requestedScale) || requestedScale <= 0) {
		return { frames: new Map(), appliedScale: 1 };
	}
	if (requestedScale === 1) {
		return { frames: new Map(), appliedScale: 1 };
	}
	const maxFrame = Math.max(0, Math.round(totalFrames) - 1);
	if (!framesValid(keyframes, movable, selectionIds, anchorFrame, 1, maxFrame, blockedRanges)) {
		return { frames: new Map(), appliedScale: 1 };
	}
	if (
		framesValid(
			keyframes,
			movable,
			selectionIds,
			anchorFrame,
			requestedScale,
			maxFrame,
			blockedRanges
		)
	) {
		return {
			frames: new Map(
				movable.map((keyframe) => [
					keyframeIdentity(keyframe),
					Math.round(anchorFrame + (keyframe.frame - anchorFrame) * requestedScale)
				])
			),
			appliedScale: requestedScale
		};
	}
	let low: number;
	let high: number;
	if (requestedScale >= 1) {
		low = 1;
		high = requestedScale;
	} else {
		low = requestedScale;
		high = 1;
	}
	for (let step = 0; step < BISECTION_STEPS; step++) {
		const mid = (low + high) / 2;
		if (framesValid(keyframes, movable, selectionIds, anchorFrame, mid, maxFrame, blockedRanges)) {
			if (requestedScale >= 1) low = mid;
			else high = mid;
		} else if (requestedScale >= 1) {
			high = mid;
		} else {
			low = mid;
		}
	}
	const appliedScale = requestedScale >= 1 ? low : high;
	return {
		frames: new Map(
			movable.map((keyframe) => [
				keyframeIdentity(keyframe),
				Math.round(anchorFrame + (keyframe.frame - anchorFrame) * appliedScale)
			])
		),
		appliedScale
	};
}

function framesValid(
	keyframes: readonly EditorKeyframe[],
	movable: readonly EditorKeyframe[],
	selectionIds: ReadonlySet<string>,
	anchorFrame: number,
	scale: number,
	maxFrame: number,
	blockedRanges: readonly BlockedFrameRange[]
): boolean {
	const mapped = new Map<string, number>();
	for (const keyframe of movable) {
		const frame = Math.round(anchorFrame + (keyframe.frame - anchorFrame) * scale);
		if (frame < 0 || frame > maxFrame) return false;
		if (blockedRanges.some((range) => frame >= range.start && frame < range.end)) return false;
		mapped.set(keyframeIdentity(keyframe), frame);
	}
	const frameOf = (keyframe: EditorKeyframe): number =>
		mapped.get(keyframeIdentity(keyframe)) ?? keyframe.frame;
	const byProperty = new Map<KeyframeProperty, EditorKeyframe[]>();
	for (const keyframe of keyframes) {
		const group = byProperty.get(keyframe.property) ?? [];
		group.push(keyframe);
		byProperty.set(keyframe.property, group);
	}
	for (const lane of byProperty.values()) {
		// A scaled key must never cross, or land on, an unmoved lane neighbor:
		// stretching past a transition hold or a cut point would reorder the lane.
		for (const moved of lane) {
			if (!mapped.has(keyframeIdentity(moved))) continue;
			for (const fixed of lane) {
				if (mapped.has(keyframeIdentity(fixed))) continue;
				const before = Math.sign(fixed.frame - moved.frame);
				const after = Math.sign(frameOf(fixed) - frameOf(moved));
				if (before !== 0 && before !== after) return false;
			}
		}
		const sorted = [...lane].toSorted((left, right) => frameOf(left) - frameOf(right));
		for (let index = 1; index < sorted.length; index++) {
			const previous = sorted[index - 1];
			const current = sorted[index];
			if (!previous || !current) continue;
			const previousMoved = mapped.has(keyframeIdentity(previous));
			const currentMoved = mapped.has(keyframeIdentity(current));
			if (!previousMoved && !currentMoved) continue;
			if (frameOf(current) - frameOf(previous) < 1) return false;
		}
	}
	return true;
}
