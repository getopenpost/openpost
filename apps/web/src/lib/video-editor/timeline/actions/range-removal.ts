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
import { sourceSecondsToTimelineFrame } from '../utils/media-item-frames';
import { pruneInvalidTransitions } from './transitions.svelte';
import {
	normalizeRippleIntervals,
	propagateRemovedIntervalsToSyncLockedTracks
} from './sync-lock-ripple';
import { effectiveMediaTracks } from '../utils/track-groups';
import { isTrackSyncLockEnabled } from '../utils/track-sync-lock';

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

interface RippleRemovalResult {
	removedItemCount: number;
	removedIds: string[];
	affectedCount: number;
}

function applyRippleRemoval(
	idsToRemove: Set<string>,
	sharedIntervals: ReturnType<typeof normalizeRippleIntervals>,
	directSyncTracks: Set<string>
): RippleRemovalResult {
	const removed = timelineStore.items.filter((item) => idsToRemove.has(item.id));
	const intervalsByTrack = new Map<string, ReturnType<typeof normalizeRippleIntervals>>();
	for (const item of removed) {
		const intervals = intervalsByTrack.get(item.trackId) ?? [];
		intervals.push({ start: item.from, end: item.from + item.durationInFrames });
		intervalsByTrack.set(item.trackId, intervals);
	}
	for (const [trackId, intervals] of intervalsByTrack) {
		intervalsByTrack.set(trackId, normalizeRippleIntervals(intervals));
	}
	// Sync-locked tracks remove elapsed time even when a cut falls in their gaps.
	for (const trackId of directSyncTracks) intervalsByTrack.set(trackId, sharedIntervals);
	const updates: Array<{ id: string; from: number }> = [];
	for (const item of timelineStore.items) {
		if (
			idsToRemove.has(item.id) ||
			item.sequenceColorGrade ||
			item.captionSource?.type === 'transcript' ||
			item.captionSource?.type === 'ai-captions'
		)
			continue;
		const shift = (intervalsByTrack.get(item.trackId) ?? [])
			.filter((interval) => interval.end <= item.from)
			.reduce((sum, interval) => sum + interval.end - interval.start, 0);
		if (shift > 0) updates.push({ id: item.id, from: item.from - shift });
	}
	// Overlapping audio is intentional. Captions follow their source during reconciliation.
	timelineStore._removeItems([...idsToRemove]);
	timelineStore._moveItems(updates);
	return {
		removedItemCount: idsToRemove.size,
		removedIds: [...idsToRemove],
		affectedCount: updates.length
	};
}

function removeTimelineRangesFromItems(
	commandType: 'REMOVE_SILENCE' | 'REMOVE_FILLER_WORDS' | 'REMOVE_TRANSCRIPT_SELECTION',
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>,
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
		const anchorIds = [...new Set(itemIds)];
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

		const descriptorsByGroup = new Map<
			string,
			{ participantIds: Set<string>; timelineRanges: SourceRange[] }
		>();
		for (const anchor of anchors) {
			const key = anchor.linkedGroupId ?? anchor.id;
			let descriptor = descriptorsByGroup.get(key);
			if (!descriptor) {
				descriptor = {
					participantIds: new Set(
						initialItems
							.filter(
								(item) =>
									!lockedTrackIds.has(item.trackId) &&
									(item.id === anchor.id ||
										(!!anchor.linkedGroupId && item.linkedGroupId === anchor.linkedGroupId))
							)
							.map((item) => item.id)
					),
					timelineRanges: []
				};
				descriptorsByGroup.set(key, descriptor);
			}
			for (const range of rangesForItem(anchor)) {
				const first = sourceSecondsToTimelineFrame(anchor, range.start, timelineFps);
				const second = sourceSecondsToTimelineFrame(anchor, range.end, timelineFps);
				descriptor.timelineRanges.push({
					start: Math.max(anchor.from, Math.min(first, second)),
					end: Math.min(anchor.from + anchor.durationInFrames, Math.max(first, second))
				});
			}
		}
		const groups = [...descriptorsByGroup.values()];
		for (const group of groups)
			group.timelineRanges = normalizeRippleIntervals(group.timelineRanges);
		const sharedIntervals = normalizeRippleIntervals(
			groups.flatMap((group) => group.timelineRanges)
		);
		const tracks = effectiveMediaTracks(timelineStore.tracks);
		const directSyncTracks = new Set(
			initialItems
				.filter(
					(item) =>
						groups.some(
							(group) => group.timelineRanges.length > 0 && group.participantIds.has(item.id)
						) && isTrackSyncLockEnabled(tracks.find((track) => track.id === item.trackId))
				)
				.map((item) => item.trackId)
		);
		const anchorDescriptors = initialItems.flatMap((item) => {
			if (
				lockedTrackIds.has(item.trackId) ||
				item.sequenceColorGrade ||
				item.captionSource?.type === 'transcript' ||
				item.captionSource?.type === 'ai-captions'
			)
				return [];
			const ownRanges = groups
				.filter((group) => group.participantIds.has(item.id))
				.flatMap((group) => group.timelineRanges);
			const timelineRanges = directSyncTracks.has(item.trackId)
				? sharedIntervals
				: normalizeRippleIntervals(ownRanges);
			return timelineRanges.length ? [{ participantIds: new Set([item.id]), timelineRanges }] : [];
		});
		let splitCount = 0;
		for (const descriptor of anchorDescriptors) {
			const boundaries = [
				...new Set(descriptor.timelineRanges.flatMap((range) => [range.start, range.end]))
			].sort((a, b) => b - a);
			for (const frame of boundaries) {
				for (const id of [...descriptor.participantIds]) {
					const item = timelineStore.itemById.get(id);
					if (!item || frame <= item.from || frame >= item.from + item.durationInFrames) continue;
					const result = timelineStore._splitItem(id, frame);
					if (!result) continue;
					descriptor.participantIds.add(result.rightItem.id);
					splitCount += 1;
				}
			}
		}

		// Remove every post-split segment mostly covered by a range.
		const currentItems = timelineStore.items;
		const idsToRemove = new Set<string>();
		let removedRangeCount = 0;
		for (const descriptor of anchorDescriptors) {
			const ranges = descriptor.timelineRanges;
			for (const candidate of currentItems) {
				if (!descriptor.participantIds.has(candidate.id)) continue;
				const span = { start: candidate.from, end: candidate.from + candidate.durationInFrames };
				if (isMostlyInsideRanges(span, ranges)) {
					idsToRemove.add(candidate.id);
					for (const range of ranges) {
						if (range.end > span.start && range.start < span.end) removedRangeCount += 1;
					}
				}
			}
		}

		// Only participating pieces covered by the timeline interval are removed.
		// Expanding the linked group here would also remove the retained pieces.
		const removedSegments = timelineStore.items.filter((item) => idsToRemove.has(item.id));
		const editedTrackIds = new Set([
			...directSyncTracks,
			...removedSegments.map((item) => item.trackId)
		]);

		const removedIntervals = removedSegments.map((item) => ({
			start: item.from,
			end: item.from + item.durationInFrames
		}));
		const captionOffsets = new Map<string, number>();
		for (const item of timelineStore.items) {
			if (item.type !== 'subtitle' || !item.captionSource?.clipId) continue;
			const owner = timelineStore.itemById.get(item.captionSource.clipId);
			if (owner) captionOffsets.set(item.id, item.from - owner.from);
		}

		const direct = applyRippleRemoval(idsToRemove, sharedIntervals, directSyncTracks);
		const propagated = propagateRemovedIntervalsToSyncLockedTracks({
			editedTrackIds,
			intervals: removedIntervals,
			captionMode: 'source'
		});
		const removedSourceIds = new Set([...direct.removedIds, ...propagated.removedIds]);
		const removedCaptionIds: string[] = [];
		const captionMoves: Array<{ id: string; from: number }> = [];
		for (const caption of timelineStore.items) {
			const source = caption.captionSource;
			if (
				caption.type !== 'subtitle' ||
				(source?.type !== 'transcript' && source?.type !== 'ai-captions') ||
				lockedTrackIds.has(caption.trackId)
			)
				continue;
			if (removedSourceIds.has(source.clipId)) {
				removedCaptionIds.push(caption.id);
				continue;
			}
			const owner = timelineStore.itemById.get(source.clipId);
			if (!owner) continue;
			const offset = captionOffsets.get(caption.id);
			const sourceTime = source.isReversed ? source.sourceEndSeconds : source.sourceStartSeconds;
			const from =
				offset !== undefined
					? owner.from + offset
					: sourceTime !== undefined
						? sourceSecondsToTimelineFrame(owner, sourceTime, timelineFps)
						: owner.from;
			captionMoves.push({ id: caption.id, from: Math.max(0, from) });
		}
		timelineStore._removeItems(removedCaptionIds);
		timelineStore._moveItems(captionMoves);

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
	silenceRangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTimelineRangesFromItems('REMOVE_SILENCE', itemIds, silenceRangesByMediaId);
}

export function removeFillerWordsFromItems(
	itemIds: string[],
	fillerRangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTimelineRangesFromItems('REMOVE_FILLER_WORDS', itemIds, fillerRangesByMediaId);
}

export function removeTranscriptRangesFromItems(
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTimelineRangesFromItems('REMOVE_TRANSCRIPT_SELECTION', itemIds, rangesByMediaId);
}

export function removeTranscriptItemRanges(rangesByItemId: ItemSourceRanges): RangeRemovalResult {
	return removeTimelineRangesFromItems(
		'REMOVE_TRANSCRIPT_SELECTION',
		Object.keys(rangesByItemId),
		{},
		rangesByItemId
	);
}
