/**
 * Trim clamping math: respect source boundaries, adjacent items on the same
 * track, and a minimum duration of one frame.
 *
 * Ported from FreeCut (MIT) — utils/trim-utils.ts, then extended for reverse
 * playback and source-anchored speed curves.
 */

import type { TimelineItem } from '../../project/types';
import {
	hasVariableSpeed,
	sourceFrameToTimelineOffset,
	timelineOffsetToSourceFrame
} from '../source-time-map';
import {
	getMaxStartExtension,
	getMaxTimelineDuration,
	getSourceProperties,
	isMediaItem,
	timelineToSourceFrames
} from './source-calculations';

export type TrimHandle = 'start' | 'end';

interface TrimClampResult {
	clampedAmount: number;
	maxExtend: number | null;
}

/**
 * Calculate the clamped trim amount respecting source boundaries.
 *
 * For media items (video/audio), trimming is constrained by:
 * - Start handle: can't extend past source start (0)
 * - End handle: can't extend past source end (sourceDuration)
 * - Both: can't shrink below 1 frame duration
 *
 * Speed is accounted for: timeline frames = source frames / speed.
 */
export function clampTrimAmount(
	item: TimelineItem,
	handle: TrimHandle,
	trimAmount: number,
	timelineFps: number = 30
): TrimClampResult {
	let clampedAmount = trimAmount;
	let maxExtend: number | null = null;

	if (isMediaItem(item)) {
		const { sourceStart, sourceFps, speed, sourceDuration } = getSourceProperties(item);
		const effectiveSourceFps = sourceFps ?? timelineFps;
		if (hasVariableSpeed(item)) {
			if (handle === 'start' && trimAmount < 0) {
				const sourceTarget = item.isReversed ? sourceDuration : 0;
				if (sourceTarget !== undefined) {
					maxExtend = Math.max(
						0,
						Math.floor(-sourceFrameToTimelineOffset(item, sourceTarget, timelineFps))
					);
					clampedAmount = Math.max(trimAmount, -maxExtend);
				}
			} else if (handle === 'end' && trimAmount > 0) {
				const sourceTarget = item.isReversed ? 0 : sourceDuration;
				if (sourceTarget !== undefined) {
					const maxDuration = Math.max(
						1,
						Math.floor(sourceFrameToTimelineOffset(item, sourceTarget, timelineFps))
					);
					maxExtend = maxDuration - item.durationInFrames;
					clampedAmount = Math.min(trimAmount, maxExtend);
				}
			}
			return {
				clampedAmount: clampToMinDuration(item.durationInFrames, handle, clampedAmount),
				maxExtend
			};
		}

		if (handle === 'start') {
			// Start handle: negative trimAmount = extending left
			if (trimAmount < 0) {
				maxExtend = getMaxStartExtension(sourceStart, speed, effectiveSourceFps, timelineFps);
				if (-trimAmount > maxExtend) {
					clampedAmount = -maxExtend;
				}
			}
		} else {
			// End handle: positive trimAmount = extending right. Always use
			// sourceDuration — trimming must stay reversible (the user can always
			// extend back to the full source regardless of prior rate stretch).
			if (sourceDuration !== undefined) {
				const maxDuration = getMaxTimelineDuration(
					sourceDuration,
					sourceStart,
					speed,
					effectiveSourceFps,
					timelineFps
				);
				maxExtend = maxDuration - item.durationInFrames;

				if (item.durationInFrames + trimAmount > maxDuration) {
					clampedAmount = maxDuration - item.durationInFrames;
				}
			}
		}
	}

	// Clamp to minimum duration of 1 frame (applies to all items)
	clampedAmount = clampToMinDuration(item.durationInFrames, handle, clampedAmount);

	return { clampedAmount, maxExtend };
}

/**
 * Clamp a start-trim amount so the item doesn't overlap the end of the previous
 * item on the same track, or an end-trim so it doesn't overlap the next start.
 * `excludedIds` are allowed to overlap (FreeCut used this for transition
 * partners; OpenPost v1 has no transitions, but the hook stays for parity).
 */
export function clampToAdjacentItems(
	item: TimelineItem,
	handle: TrimHandle,
	trimAmount: number,
	allItems: TimelineItem[],
	excludedIds?: Set<string>
): number {
	const itemEnd = item.from + item.durationInFrames;

	if (handle === 'end' && trimAmount > 0) {
		// Extending right — find nearest item that starts at or after our current end
		let nearestStart = Infinity;
		for (const other of allItems) {
			if (other.id === item.id) continue;
			if (other.trackId !== item.trackId) continue;
			if (excludedIds?.has(other.id)) continue;
			if (other.from >= itemEnd) {
				nearestStart = Math.min(nearestStart, other.from);
			}
		}
		if (nearestStart !== Infinity && trimAmount > nearestStart - itemEnd) {
			return nearestStart - itemEnd;
		}
	} else if (handle === 'start' && trimAmount < 0) {
		// Extending left — find nearest item that ends at or before our current start
		let nearestEnd = -Infinity;
		for (const other of allItems) {
			if (other.id === item.id) continue;
			if (other.trackId !== item.trackId) continue;
			if (excludedIds?.has(other.id)) continue;
			const otherEnd = other.from + other.durationInFrames;
			if (otherEnd <= item.from) {
				nearestEnd = Math.max(nearestEnd, otherEnd);
			}
		}
		if (nearestEnd !== -Infinity && -trimAmount > item.from - nearestEnd) {
			const maxExtend = item.from - nearestEnd;
			return maxExtend > 0 ? -maxExtend : 0;
		}
	}

	return trimAmount;
}

/** Clamp trim amount so the resulting duration is at least 1 frame. */
function clampToMinDuration(
	currentDuration: number,
	handle: TrimHandle,
	trimAmount: number
): number {
	if (handle === 'start') {
		// Start: positive trim shrinks, negative extends
		if (currentDuration - trimAmount <= 0) {
			return currentDuration - 1;
		}
	} else if (currentDuration + trimAmount <= 0) {
		// End: positive trim extends, negative shrinks
		return -currentDuration + 1;
	}
	return trimAmount;
}

export interface TrimSourceUpdate {
	sourceStart?: number;
	sourceEnd?: number;
}

/** Calculate new source boundaries after a trim operation. */
export function calculateTrimSourceUpdate(
	item: TimelineItem,
	handle: TrimHandle,
	clampedAmount: number,
	newDuration: number,
	timelineFps: number = 30
): TrimSourceUpdate | null {
	if (!isMediaItem(item)) return null;

	const { sourceStart, sourceEnd, sourceFps, speed, sourceDuration } = getSourceProperties(item);
	const effectiveSourceFps = sourceFps ?? timelineFps;
	if (hasVariableSpeed(item)) {
		if (handle === 'start') {
			const boundary = Math.round(
				timelineOffsetToSourceFrame(item, clampedAmount, timelineFps) + (item.isReversed ? 1 : 0)
			);
			return item.isReversed ? { sourceEnd: boundary } : { sourceStart: boundary };
		}
		const boundary = Math.round(
			timelineOffsetToSourceFrame(item, newDuration, timelineFps) + (item.isReversed ? 1 : 0)
		);
		return item.isReversed ? { sourceStart: boundary } : { sourceEnd: boundary };
	}

	if (handle === 'start') {
		const sourceFramesDelta = timelineToSourceFrames(
			clampedAmount,
			speed,
			timelineFps,
			effectiveSourceFps
		);
		return { sourceStart: sourceStart + sourceFramesDelta };
	}

	// Trimming end: update sourceEnd. For clips with explicit sourceEnd, update
	// by delta to avoid cumulative one-frame loss from duration-based recompute.
	const sourceFramesDelta = timelineToSourceFrames(
		clampedAmount,
		speed,
		timelineFps,
		effectiveSourceFps
	);
	const recomputedSourceEnd =
		sourceStart + timelineToSourceFrames(newDuration, speed, timelineFps, effectiveSourceFps);
	const newSourceEnd =
		sourceEnd !== undefined ? sourceEnd + sourceFramesDelta : recomputedSourceEnd;

	// Keep at least 1 source frame and clamp to media bounds.
	const boundedByMin = Math.max(sourceStart + 1, newSourceEnd);
	const clampedSourceEnd =
		sourceDuration !== undefined ? Math.min(boundedByMin, sourceDuration) : boundedByMin;
	return { sourceEnd: clampedSourceEnd };
}
