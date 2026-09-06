/**
 * Sync-lock ripple propagation for edits that insert or remove timeline time.
 *
 * Ported from FreeCut (MIT) - stores/actions/sync-lock-ripple.ts.
 */

import type { TimelineItem, TimelineTrack } from '../../project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { isTrackSyncLockEnabled } from '../utils/track-sync-lock';
import { effectiveMediaTracks } from '../utils/track-groups';
import { transitionsStore } from './transitions-store.svelte';

export interface RipplePropagationResult {
	affectedIds: string[];
	removedIds: string[];
}

export interface TimeInterval {
	start: number;
	end: number;
}

export interface SyncLockPreviewUpdate {
	id: string;
	from?: number;
	durationInFrames?: number;
	hidden?: boolean;
}

interface PreviewTrackItemState {
	id: string;
	trackId: string;
	from: number;
	durationInFrames: number;
}

function uniqueIds(ids: string[]): string[] {
	return Array.from(new Set(ids));
}

export function normalizeRippleIntervals(intervals: TimeInterval[]): TimeInterval[] {
	const sorted = intervals
		.map((interval) => ({
			start: Math.max(0, Math.round(interval.start)),
			end: Math.max(0, Math.round(interval.end))
		}))
		.filter((interval) => interval.end > interval.start)
		.sort((left, right) => left.start - right.start);
	if (sorted.length === 0) return [];

	const merged: TimeInterval[] = [{ ...sorted[0] }];
	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index];
		const previous = merged[merged.length - 1];
		if (!current || !previous) continue;
		if (current.start <= previous.end) {
			previous.end = Math.max(previous.end, current.end);
			continue;
		}
		merged.push({ ...current });
	}
	return merged;
}

function candidateTrackIdsFromState(
	items: TimelineItem[],
	tracks: TimelineTrack[],
	editedTrackIds: ReadonlySet<string>
): string[] {
	const effectiveTracks = effectiveMediaTracks(tracks);
	const trackIds = new Set<string>();
	for (const track of effectiveTracks) {
		if (!editedTrackIds.has(track.id) && isTrackSyncLockEnabled(track)) trackIds.add(track.id);
	}
	for (const item of items) {
		if (editedTrackIds.has(item.trackId) || trackIds.has(item.trackId)) continue;
		const track = effectiveTracks.find((candidate) => candidate.id === item.trackId);
		if (isTrackSyncLockEnabled(track)) trackIds.add(item.trackId);
	}
	return [...trackIds];
}

function setPreviewUpdate(
	updatesById: Map<string, SyncLockPreviewUpdate>,
	itemId: string,
	updates: Omit<SyncLockPreviewUpdate, 'id'>
): void {
	updatesById.set(itemId, {
		...(updatesById.get(itemId) ?? { id: itemId }),
		...updates
	});
}

function removedIntervalPreviewUpdatesForTrack(
	trackItems: TimelineItem[],
	intervals: TimeInterval[]
): SyncLockPreviewUpdate[] {
	let previewItems: PreviewTrackItemState[] = trackItems
		.map(({ id, trackId, from, durationInFrames }) => ({
			id,
			trackId,
			from,
			durationInFrames
		}))
		.sort((left, right) => left.from - right.from);
	const updatesById = new Map<string, SyncLockPreviewUpdate>();
	let removedFrames = 0;

	for (const interval of normalizeRippleIntervals(intervals)) {
		const currentInterval = {
			start: interval.start - removedFrames,
			end: interval.end - removedFrames
		};
		const intervalLength = currentInterval.end - currentInterval.start;
		if (intervalLength <= 0) continue;
		const nextPreviewItems: PreviewTrackItemState[] = [];

		for (const item of previewItems) {
			const itemEnd = item.from + item.durationInFrames;
			if (itemEnd <= currentInterval.start) {
				nextPreviewItems.push(item);
				continue;
			}
			if (item.from >= currentInterval.end) {
				const updated = {
					...item,
					from: Math.max(0, item.from - intervalLength)
				};
				nextPreviewItems.push(updated);
				setPreviewUpdate(updatesById, item.id, { from: updated.from });
				continue;
			}

			const startsBeforeInterval = item.from < currentInterval.start;
			const endsAfterInterval = itemEnd > currentInterval.end;
			if (!startsBeforeInterval && !endsAfterInterval) {
				setPreviewUpdate(updatesById, item.id, { hidden: true });
				continue;
			}
			if (startsBeforeInterval && endsAfterInterval) {
				const updated = {
					...item,
					durationInFrames: Math.max(1, item.durationInFrames - intervalLength)
				};
				nextPreviewItems.push(updated);
				setPreviewUpdate(updatesById, item.id, {
					durationInFrames: updated.durationInFrames
				});
				continue;
			}
			if (startsBeforeInterval) {
				const updated = {
					...item,
					durationInFrames: Math.max(1, currentInterval.start - item.from)
				};
				nextPreviewItems.push(updated);
				setPreviewUpdate(updatesById, item.id, {
					durationInFrames: updated.durationInFrames
				});
				continue;
			}

			const updated = {
				...item,
				from: currentInterval.start,
				durationInFrames: Math.max(1, itemEnd - currentInterval.end)
			};
			nextPreviewItems.push(updated);
			setPreviewUpdate(updatesById, item.id, {
				from: updated.from,
				durationInFrames: updated.durationInFrames
			});
		}
		previewItems = nextPreviewItems.sort((left, right) => left.from - right.from);
		removedFrames += intervalLength;
	}
	return [...updatesById.values()];
}

function insertedGapPreviewUpdatesForTrack(
	trackItems: TimelineItem[],
	cutFrame: number,
	amount: number
): SyncLockPreviewUpdate[] {
	const updatesById = new Map<string, SyncLockPreviewUpdate>();
	for (const item of trackItems) {
		const itemEnd = item.from + item.durationInFrames;
		if (itemEnd <= cutFrame) continue;
		if (item.from >= cutFrame) {
			setPreviewUpdate(updatesById, item.id, { from: item.from + amount });
			continue;
		}
		setPreviewUpdate(updatesById, item.id, {
			durationInFrames: item.durationInFrames + amount
		});
	}
	return [...updatesById.values()];
}

export function buildRemovedIntervalPreviewUpdatesForSyncLockedTracks(params: {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	editedTrackIds: ReadonlySet<string>;
	intervals: TimeInterval[];
}): SyncLockPreviewUpdate[] {
	const intervals = normalizeRippleIntervals(params.intervals);
	if (intervals.length === 0) return [];
	const candidateTrackIds = candidateTrackIdsFromState(
		params.items,
		params.tracks,
		params.editedTrackIds
	);
	return candidateTrackIds.flatMap((trackId) =>
		removedIntervalPreviewUpdatesForTrack(
			params.items.filter((item) => item.trackId === trackId),
			intervals
		)
	);
}

export function buildInsertedGapPreviewUpdatesForSyncLockedTracks(params: {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	editedTrackIds: ReadonlySet<string>;
	cutFrame: number;
	amount: number;
}): SyncLockPreviewUpdate[] {
	const cutFrame = Math.max(0, Math.round(params.cutFrame));
	const amount = Math.max(0, Math.round(params.amount));
	if (amount === 0) return [];
	const candidateTrackIds = candidateTrackIdsFromState(
		params.items,
		params.tracks,
		params.editedTrackIds
	);
	return candidateTrackIds.flatMap((trackId) =>
		insertedGapPreviewUpdatesForTrack(
			params.items.filter((item) => item.trackId === trackId),
			cutFrame,
			amount
		)
	);
}

function splitItemWithBookkeeping(
	itemId: string,
	splitFrame: number
): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
	const current = timelineStore.itemById.get(itemId);
	if (!current) return null;
	const originalLinkedGroupId = current.linkedGroupId;
	const result = timelineStore._splitItem(itemId, splitFrame);
	if (!result) return null;

	transitionsStore.setAll(
		transitionsStore.list.map((transition) =>
			transition.fromItemId === itemId
				? { ...transition, fromItemId: result.rightItem.id }
				: transition
		)
	);
	if (originalLinkedGroupId) {
		timelineStore._updateItems([
			{ id: result.leftItem.id, patch: { linkedGroupId: undefined } },
			{ id: result.rightItem.id, patch: { linkedGroupId: undefined } }
		]);
	}
	return result;
}

function removeItemsOnTrackInterval(
	trackId: string,
	interval: TimeInterval
): RipplePropagationResult {
	const affectedIds: string[] = [];
	const removedIds: string[] = [];
	const overlapping = timelineStore.items
		.filter(
			(item) =>
				item.trackId === trackId &&
				item.from < interval.end &&
				item.from + item.durationInFrames > interval.start
		)
		.sort((left, right) => left.from - right.from);

	for (const overlappingItem of overlapping) {
		const current = timelineStore.itemById.get(overlappingItem.id);
		if (!current || current.trackId !== trackId) continue;
		const itemEnd = current.from + current.durationInFrames;
		const startsBeforeInterval = current.from < interval.start;
		const endsAfterInterval = itemEnd > interval.end;

		if (!startsBeforeInterval && !endsAfterInterval) {
			timelineStore._removeItems([current.id]);
			removedIds.push(current.id);
			continue;
		}
		if (startsBeforeInterval && endsAfterInterval) {
			const splitAtStart = splitItemWithBookkeeping(current.id, interval.start);
			if (!splitAtStart) continue;
			affectedIds.push(splitAtStart.leftItem.id, splitAtStart.rightItem.id);
			const splitAtEnd = splitItemWithBookkeeping(splitAtStart.rightItem.id, interval.end);
			if (!splitAtEnd) continue;
			timelineStore._removeItems([splitAtEnd.leftItem.id]);
			removedIds.push(splitAtEnd.leftItem.id);
			affectedIds.push(splitAtEnd.rightItem.id);
			continue;
		}
		if (startsBeforeInterval) {
			const split = splitItemWithBookkeeping(current.id, interval.start);
			if (!split) continue;
			timelineStore._removeItems([split.rightItem.id]);
			removedIds.push(split.rightItem.id);
			affectedIds.push(split.leftItem.id);
			continue;
		}

		const split = splitItemWithBookkeeping(current.id, interval.end);
		if (!split) continue;
		timelineStore._removeItems([split.leftItem.id]);
		removedIds.push(split.leftItem.id);
		affectedIds.push(split.rightItem.id);
	}
	return {
		affectedIds: uniqueIds(affectedIds),
		removedIds: uniqueIds(removedIds)
	};
}

function shiftTrackItems(
	trackId: string,
	predicate: (item: TimelineItem) => boolean,
	delta: number
): string[] {
	if (delta === 0) return [];
	const updates = timelineStore.items
		.filter((item) => item.trackId === trackId && predicate(item))
		.map((item) => ({ id: item.id, from: Math.max(0, item.from + delta) }));
	if (updates.length > 0) timelineStore._moveItems(updates);
	return updates.map((update) => update.id);
}

export function propagateRemovedIntervalsToSyncLockedTracks(params: {
	editedTrackIds: ReadonlySet<string>;
	intervals: TimeInterval[];
}): RipplePropagationResult {
	const intervals = normalizeRippleIntervals(params.intervals);
	if (intervals.length === 0) return { affectedIds: [], removedIds: [] };
	const candidateTrackIds = candidateTrackIdsFromState(
		timelineStore.items,
		timelineStore.tracks,
		params.editedTrackIds
	);
	const affectedIds: string[] = [];
	const removedIds: string[] = [];

	for (const trackId of candidateTrackIds) {
		let removedFrames = 0;
		for (const interval of intervals) {
			const currentInterval = {
				start: interval.start - removedFrames,
				end: interval.end - removedFrames
			};
			const intervalLength = currentInterval.end - currentInterval.start;
			if (intervalLength <= 0) continue;
			const overlapResult = removeItemsOnTrackInterval(trackId, currentInterval);
			affectedIds.push(...overlapResult.affectedIds);
			removedIds.push(...overlapResult.removedIds);
			affectedIds.push(
				...shiftTrackItems(trackId, (item) => item.from >= currentInterval.end, -intervalLength)
			);
			removedFrames += intervalLength;
		}
	}
	return {
		affectedIds: uniqueIds(affectedIds),
		removedIds: uniqueIds(removedIds)
	};
}

export function propagateInsertedGapToSyncLockedTracks(params: {
	editedTrackIds: ReadonlySet<string>;
	cutFrame: number;
	amount: number;
}): RipplePropagationResult {
	const cutFrame = Math.max(0, Math.round(params.cutFrame));
	const amount = Math.max(0, Math.round(params.amount));
	if (amount === 0) return { affectedIds: [], removedIds: [] };
	const candidateTrackIds = candidateTrackIdsFromState(
		timelineStore.items,
		timelineStore.tracks,
		params.editedTrackIds
	);
	const affectedIds: string[] = [];

	for (const trackId of candidateTrackIds) {
		const straddledItems = timelineStore.items
			.filter(
				(item) =>
					item.trackId === trackId &&
					item.from < cutFrame &&
					item.from + item.durationInFrames > cutFrame
			)
			.sort((left, right) => left.from - right.from);
		for (const straddledItem of straddledItems) {
			const current = timelineStore.itemById.get(straddledItem.id);
			if (!current || current.trackId !== trackId) continue;
			const splitResult = splitItemWithBookkeeping(current.id, cutFrame);
			if (!splitResult) continue;
			affectedIds.push(splitResult.leftItem.id, splitResult.rightItem.id);
		}
		affectedIds.push(...shiftTrackItems(trackId, (item) => item.from >= cutFrame, amount));
	}
	return { affectedIds: uniqueIds(affectedIds), removedIds: [] };
}
