/**
 * Range-removal machinery: convert source-second ranges (silence, filler
 * words, transcript selections) into split frames, remove the covered
 * segments, and ripple the remainder — all as one undo step.
 *
 * A post-split segment is removed when at least SILENCE_COVERAGE_THRESHOLD
 * of its source-time span is covered by a range. The threshold guards both
 * un-splittable partial segments and float rounding at range edges.
 *
 * Ported from FreeCut (MIT) - edit/range-removal-actions.ts, with locked-track,
 * transition, and sync-lock repair for OpenPost's multi-track timeline.
 */

import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { getUniqueLinkedItemAnchorIds } from '../utils/linked-items';
import { getItemSourceSpanSeconds, sourceSecondsToTimelineFrame } from '../utils/media-item-frames';
import { pruneInvalidTransitions } from './transitions.svelte';
import { propagateRemovedIntervalsToSyncLockedTracks } from './sync-lock-ripple';
import { effectiveMediaTracks } from '../utils/track-groups';

export interface SourceRange {
	start: number;
	end: number;
}

export interface RangeRemovalResult {
	analyzedItemCount: number;
	removedRangeCount: number;
	removedItemCount: number;
	splitCount: number;
}

export interface ItemSourceRanges {
	[itemId: string]: SourceRange[];
}

export const SILENCE_COVERAGE_REMOVAL_THRESHOLD = 0.75;

function isMostlyInsideRanges(
	span: { start: number; end: number },
	ranges: readonly SourceRange[]
): boolean {
	const duration = span.end - span.start;
	if (duration <= 0) return false;
	const covered = ranges.reduce((sum, range) => {
		const overlapStart = Math.max(span.start, range.start);
		const overlapEnd = Math.min(span.end, range.end);
		return sum + Math.max(0, overlapEnd - overlapStart);
	}, 0);
	return covered / duration >= SILENCE_COVERAGE_REMOVAL_THRESHOLD;
}

/**
 * Remove items whose source span is ≥75% covered, then shift later items on
 * the same track left by the removed durations. Items that would land inside
 * another shifted item are dropped entirely (full overlap).
 */
/** Outcome of a ripple removal pass. */
interface RippleRemovalResult {
	removedItemCount: number;
	affectedCount: number;
}

function applyRippleRemoval(idsToRemove: Set<string>): RippleRemovalResult {
	const items = timelineStore.items;
	const remaining = items.filter((item) => !idsToRemove.has(item.id));

	const shiftByItemId = new Map<string, number>();
	for (const item of remaining) {
		const shift = items
			.filter((deleted) => idsToRemove.has(deleted.id))
			.filter(
				(deleted) =>
					deleted.trackId === item.trackId && deleted.from + deleted.durationInFrames <= item.from
			)
			.reduce((sum, deleted) => sum + deleted.durationInFrames, 0);
		if (shift > 0) shiftByItemId.set(item.id, shift);
	}

	const updates: Array<{ id: string; from: number }> = [];
	for (const item of remaining) {
		const shift = shiftByItemId.get(item.id) ?? 0;
		if (shift > 0) updates.push({ id: item.id, from: item.from - shift });
	}

	// Drop fully-covered survivors instead of stacking duplicates.
	const shifted = new Map(updates.map((u) => [u.id, u.from] as const));
	const coveredIds = new Set<string>();
	for (const item of remaining) {
		if (shifted.has(item.id)) continue;
		const itemEnd = item.from + item.durationInFrames;
		for (const other of remaining) {
			const newFrom = shifted.get(other.id);
			if (newFrom === undefined || other.trackId !== item.trackId) continue;
			if (newFrom < itemEnd && newFrom + other.durationInFrames > item.from) {
				coveredIds.add(item.id);
				break;
			}
		}
	}
	const filteredUpdates =
		coveredIds.size > 0 ? updates.filter((u) => !coveredIds.has(u.id)) : updates;

	timelineStore._removeItems([...idsToRemove, ...coveredIds]);
	timelineStore._moveItems(filteredUpdates);
	return {
		removedItemCount: idsToRemove.size + coveredIds.size,
		affectedCount: filteredUpdates.length
	};
}

export function removeTimelineRangesFromItems(
	commandType: 'REMOVE_SILENCE' | 'REMOVE_FILLER_WORDS' | 'REMOVE_TRANSCRIPT_SELECTION',
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>,
	afterRemove?: () => void,
	rangesByItemId?: ItemSourceRanges
): RangeRemovalResult {
	if (itemIds.length === 0) {
		return {
			analyzedItemCount: 0,
			removedRangeCount: 0,
			removedItemCount: 0,
			splitCount: 0
		};
	}

	return execute(commandType, () => {
		const timelineFps = timelineStore.fps;
		const initialItems = timelineStore.items;
		const lockedTrackIds = new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		const anchorIds = getUniqueLinkedItemAnchorIds(initialItems, itemIds);
		const rangesForItem = (item: TimelineItem): readonly SourceRange[] =>
			rangesByItemId?.[item.id] ?? (item.mediaId ? rangesByMediaId[item.mediaId] : undefined) ?? [];
		const anchors = anchorIds
			.map((id) => initialItems.find((item) => item.id === id))
			.filter(
				(item): item is TimelineItem =>
					item !== undefined &&
					(item.type === 'video' || item.type === 'audio') &&
					!lockedTrackIds.has(item.trackId) &&
					!!item.mediaId &&
					rangesForItem(item).length > 0
			);

		if (anchors.length === 0) {
			return {
				analyzedItemCount: 0,
				removedRangeCount: 0,
				removedItemCount: 0,
				splitCount: 0
			};
		}

		const anchorDescriptors = anchors.map((item) => ({
			id: item.id,
			// SAFETY: the anchor filter requires a non-null mediaId.
			mediaId: item.mediaId as string,
			originId: item.originId ?? item.id,
			ranges: rangesForItem(item)
		}));

		// Split each anchor (and its linked companions) at every range boundary
		// (descending so earlier splits don't invalidate later frame positions).
		let splitCount = 0;
		for (const anchor of anchors) {
			// SAFETY: the anchor filter requires a non-null mediaId.
			const ranges = rangesForItem(anchor);
			const splitFrames = Array.from(
				new Set(
					ranges.flatMap((range) => [
						sourceSecondsToTimelineFrame(anchor, range.start, timelineFps),
						sourceSecondsToTimelineFrame(anchor, range.end, timelineFps)
					])
				)
			)
				.filter((frame) => {
					const live = timelineStore.itemById.get(anchor.id);
					if (!live) return false;
					return frame > live.from && frame < live.from + live.durationInFrames;
				})
				.sort((a, b) => b - a);

			for (const frame of splitFrames) {
				const anchorResult = timelineStore._splitItem(anchor.id, frame, {
					synchronizeTranscriptCaptions: false
				});
				if (!anchorResult) continue;
				splitCount += 1;
				const linkedGroupId = anchorResult.leftItem.linkedGroupId;
				if (!linkedGroupId) continue;
				for (const companion of timelineStore.items) {
					if (companion.linkedGroupId !== linkedGroupId || companion.id === anchor.id) continue;
					if (lockedTrackIds.has(companion.trackId)) continue;
					if (frame > companion.from && frame < companion.from + companion.durationInFrames) {
						if (
							timelineStore._splitItem(companion.id, frame, {
								synchronizeTranscriptCaptions: false
							})
						)
							splitCount += 1;
					}
				}
			}
		}

		// Remove every post-split segment mostly covered by a range.
		const currentItems = timelineStore.items;
		const idsToRemove = new Set<string>();
		let removedRangeCount = 0;
		for (const descriptor of anchorDescriptors) {
			const ranges = descriptor.ranges;
			for (const candidate of currentItems) {
				if (candidate.type !== 'video' && candidate.type !== 'audio') continue;
				if (candidate.mediaId !== descriptor.mediaId) continue;
				if ((candidate.originId ?? candidate.id) !== descriptor.originId) continue;
				const span = getItemSourceSpanSeconds(candidate, timelineFps);
				if (span !== null && isMostlyInsideRanges(span, ranges)) {
					idsToRemove.add(candidate.id);
					for (const range of ranges) {
						if (range.end > span.start && range.start < span.end) removedRangeCount += 1;
					}
				}
			}
		}

		// Coverage above already catches every aligned piece (video and audio
		// candidates share the media's ranges), so removal is direct — no
		// linked-group expansion, which would blanket-remove whole groups
		// since all split pieces keep the group id.
		const removedSegments = timelineStore.items.filter((item) => idsToRemove.has(item.id));
		const editedTrackIds = new Set(removedSegments.map((item) => item.trackId));
		// Transcript items receive source-aware timing repair in the callback. Do
		// not also cut their whole track through generic sync-lock propagation.
		for (const item of timelineStore.items) {
			if (item.type === 'subtitle' && item.captionSource?.type === 'transcript')
				editedTrackIds.add(item.trackId);
		}
		const removedIntervals = removedSegments.map((item) => ({
			start: item.from,
			end: item.from + item.durationInFrames
		}));
		const direct = applyRippleRemoval(idsToRemove);
		const propagated = propagateRemovedIntervalsToSyncLockedTracks({
			editedTrackIds,
			intervals: removedIntervals
		});
		afterRemove?.();
		pruneInvalidTransitions();

		return {
			analyzedItemCount: anchors.length,
			removedRangeCount,
			removedItemCount: direct.removedItemCount + propagated.removedIds.length,
			splitCount
		};
	});
}

export function removeSilenceFromItems(
	itemIds: string[],
	silenceRangesByMediaId: Record<string, SourceRange[]>,
	afterRemove?: () => void
): RangeRemovalResult {
	return removeTimelineRangesFromItems(
		'REMOVE_SILENCE',
		itemIds,
		silenceRangesByMediaId,
		afterRemove
	);
}

export function removeFillerWordsFromItems(
	itemIds: string[],
	fillerRangesByMediaId: Record<string, SourceRange[]>,
	afterRemove?: () => void
): RangeRemovalResult {
	return removeTimelineRangesFromItems(
		'REMOVE_FILLER_WORDS',
		itemIds,
		fillerRangesByMediaId,
		afterRemove
	);
}

export function removeTranscriptRangesFromItems(
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>,
	afterRemove?: () => void
): RangeRemovalResult {
	return removeTimelineRangesFromItems(
		'REMOVE_TRANSCRIPT_SELECTION',
		itemIds,
		rangesByMediaId,
		afterRemove
	);
}

export function removeTranscriptItemRanges(
	rangesByItemId: ItemSourceRanges,
	afterRemove?: () => void
): RangeRemovalResult {
	return removeTimelineRangesFromItems(
		'REMOVE_TRANSCRIPT_SELECTION',
		Object.keys(rangesByItemId),
		{},
		afterRemove,
		rangesByItemId
	);
}
