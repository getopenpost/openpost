/**
 * Timeline item edit actions. Every public action runs inside `execute`
 * so it lands as one undoable step.
 *
 * Ported from FreeCut (MIT) - item-actions.ts / split-actions.ts and kept
 * aligned with linked selection, transitions, and sync-lock ripple rules.
 */

import type { ShapeType, TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { detachTransformChildrenForRemoval } from './transform-parenting';
import { editorSession } from '../../editor.svelte';
import { execute } from '../commands/command-store.svelte';
import {
	canLinkSelection,
	expandSelectionWithLinkedItems,
	getLinkedItemIds,
	getSynchronizedLinkedItems,
	getSynchronizedLinkedCounterpartPair
} from '../utils/linked-items';
import { pruneInvalidTransitions, pruneOrphanedTransitions } from './transitions.svelte';
import { propagateRemovedIntervalsToSyncLockedTracks } from './sync-lock-ripple';
import { isTrackSyncLockEnabled } from '../utils/track-sync-lock';
import { transitionsStore } from './transitions-store.svelte';
import { snapshotTimelineState } from '../utils/state-snapshot.svelte';
import { canJoinMultipleItems, joinedTimelineItem } from '../join-items';
import { clonePropertyRuntime } from './property-runtime';
import { hasPathVertexKeyframes } from '../path-vertex-keyframes';
import { effectiveMediaTracks } from '../utils/track-groups';
import { sequenceStore } from '../../sequences/sequence-store.svelte';
import { scaleItemKeyframes } from '../edit-constraints';
import { scaleItemVectorKeyframes } from '../vector-keyframes';
import {
	clampSpeed,
	sourceToTimelineFrames,
	timelineToSourceFrames
} from '../utils/source-calculations';

export function addItems(newItems: TimelineItem[]): void {
	execute('ADD_ITEMS', () => {
		timelineStore._setItems([...timelineStore.items, ...newItems]);
	});
}

export function addTextItem(label: string): string {
	return execute('ADD_TEXT_ITEM', () => {
		const topVisualTrack = effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required to add text.');

		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from: timelineStore.currentFrame,
			durationInFrames: timelineStore.fps * 3,
			label,
			text: label,
			type: 'text'
		});
		return id;
	});
}

/** Add a non-rendering transform controller that can parent visual layers. */
export function addTransformController(label: string): string {
	return execute('ADD_TRANSFORM_CONTROLLER', () => {
		const topVisualTrack = effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required.');

		const id = crypto.randomUUID();
		const size = Math.max(
			80,
			Math.round(Math.min(sequenceStore.activeWidth, sequenceStore.activeHeight) * 0.12)
		);
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from: 0,
			durationInFrames: Math.max(timelineStore.fps, timelineStore.maxItemEndFrame),
			label,
			type: 'controller',
			transform: {
				x: 0,
				y: 0,
				width: size,
				height: size,
				rotation: 0,
				opacity: 1
			}
		});
		return id;
	});
}

const SHAPE_LABELS = {
	rectangle: 'Rectangle',
	circle: 'Circle',
	triangle: 'Triangle',
	ellipse: 'Ellipse',
	star: 'Star',
	polygon: 'Polygon',
	heart: 'Heart',
	path: 'Path'
} satisfies Record<ShapeType, string>;

/** Add a styled three-second shape on the top unlocked visual track. */
export function addShapeItem(shapeType: ShapeType, label = SHAPE_LABELS[shapeType]): string {
	return execute('ADD_SHAPE_ITEM', () => {
		const topVisualTrack = effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required to add a shape.');

		const projectWidth = editorSession.project?.metadata.width ?? 1920;
		const projectHeight = editorSession.project?.metadata.height ?? 1080;
		const size = Math.max(80, Math.round(Math.min(projectWidth, projectHeight) * 0.28));
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from: timelineStore.currentFrame,
			durationInFrames: timelineStore.fps * 3,
			label,
			type: 'shape',
			shapeType,
			fillColor: '#f97316',
			fillEnabled: shapeType !== 'path',
			strokeColor: '#ffffff',
			strokeEnabled: shapeType === 'path',
			strokeWidth: 8,
			shapePoints: shapeType === 'star' ? 5 : shapeType === 'polygon' ? 6 : undefined,
			shapeInnerRadius: shapeType === 'star' ? 0.5 : undefined,
			transform: {
				width:
					shapeType === 'path'
						? projectWidth
						: shapeType === 'rectangle' || shapeType === 'ellipse'
							? Math.round(size * 1.35)
							: size,
				height: shapeType === 'path' ? projectHeight : size,
				aspectRatioLocked:
					shapeType !== 'path' && shapeType !== 'rectangle' && shapeType !== 'ellipse'
			}
		});
		return id;
	});
}

/** Add a three-second adjustment layer on the top visual track at the playhead. */
export function addAdjustmentLayer(label: string): string {
	return execute('ADD_ADJUSTMENT_LAYER', () => {
		let topVisualTrack = effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required.');

		const from = timelineStore.currentFrame;
		const durationInFrames = timelineStore.fps * 3;
		const end = from + durationInFrames;
		const topTrackOccupied = (timelineStore.itemsByTrackId.get(topVisualTrack.id) ?? []).some(
			(item) => item.from < end && item.from + item.durationInFrames > from
		);
		if (topTrackOccupied) {
			topVisualTrack = {
				...topVisualTrack,
				id: crypto.randomUUID(),
				name: label,
				order: Math.min(...timelineStore.tracks.map((track) => track.order)) - 1
			};
			timelineStore._setTracks([...timelineStore.tracks, topVisualTrack]);
		}

		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: topVisualTrack.id,
			from,
			durationInFrames,
			label,
			type: 'adjustment',
			effects: []
		});
		return id;
	});
}

function deletableItemIds(ids: string[], expandLinked: boolean): string[] {
	const requested = expandLinked
		? expandSelectionWithLinkedItems(timelineStore.items, ids)
		: [...new Set(ids)];
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	return requested.filter((id) => {
		const item = timelineStore.itemById.get(id);
		return item !== undefined && trackById.get(item.trackId)?.locked !== true;
	});
}

export function removeItems(
	ids: string[],
	expandLinked = timelineStore.linkedSelectionEnabled
): string[] {
	const deletableIds = deletableItemIds(ids, expandLinked);
	if (deletableIds.length === 0) return [];
	return execute('REMOVE_ITEMS', () => {
		detachTransformChildrenForRemoval(deletableIds);
		timelineStore._removeItems(deletableIds);
		pruneOrphanedTransitions();
		return deletableIds;
	});
}

export function moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
	if (updates.length === 0) return;
	execute('MOVE_ITEMS', () => {
		timelineStore._moveItems(updates);
	});
}

export function updateItemProperties(
	id: string,
	patch: Partial<TimelineItem>,
	commandType = 'UPDATE_ITEM'
): void {
	execute(commandType, () => {
		const item = timelineStore.itemById.get(id);
		if (item && pathTopologyChangeIsLocked(item, patch)) return;
		timelineStore._updateItems([{ id, patch }]);
	});
}

function pathTopologyChangeIsLocked(item: TimelineItem, patch: Partial<TimelineItem>): boolean {
	if (
		item.type !== 'shape' ||
		item.shapeType !== 'path' ||
		!hasPathVertexKeyframes(item.keyframes)
	) {
		return false;
	}
	return (
		patch.pathVertices !== undefined ||
		(patch.pathClosed !== undefined && patch.pathClosed !== (item.pathClosed ?? true)) ||
		(patch.shapeType !== undefined && patch.shapeType !== item.shapeType)
	);
}

/** Toggle reverse playback for media clips and their linked A/V companions. */
export function setItemsReversed(ids: string[], isReversed: boolean): string[] {
	const expanded = expandSelectionWithLinkedItems(timelineStore.items, ids);
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	const targets = expanded.filter((id) => {
		const item = timelineStore.itemById.get(id);
		return (
			item !== undefined &&
			(item.type === 'video' || item.type === 'audio') &&
			trackById.get(item.trackId)?.locked !== true &&
			item.isReversed !== isReversed
		);
	});
	if (targets.length === 0) return [];
	execute('SET_ITEMS_REVERSED', () => {
		timelineStore._updateItems(targets.map((id) => ({ id, patch: { isReversed } })));
	});
	return targets;
}

/** Join continuous split siblings, including synchronized linked A/V counterparts. */
export function joinItems(ids: string[]): string[] {
	const selected = ids
		.map((id) => timelineStore.itemById.get(id))
		.filter((item): item is TimelineItem => item !== undefined);
	if (selected.length < 2) return [];
	const candidates = new Map(selected.map((item) => [item.id, item]));
	if (selected.length === 2 && timelineStore.linkedSelectionEnabled) {
		const pair = getSynchronizedLinkedCounterpartPair(
			timelineStore.items,
			selected[0]!.id,
			selected[1]!.id
		);
		if (pair) {
			candidates.set(pair.leftCounterpart.id, pair.leftCounterpart);
			candidates.set(pair.rightCounterpart.id, pair.rightCounterpart);
		}
	}

	const groups = new Map<string, TimelineItem[]>();
	for (const item of candidates.values()) {
		const key = `${item.trackId}\u0000${item.type}`;
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	const lockedTrackIds = new Set(
		effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.locked)
			.map((track) => track.id)
	);
	const joinableGroups = [...groups.values()].filter(
		(group) => !lockedTrackIds.has(group[0]!.trackId) && canJoinMultipleItems(group)
	);
	if (joinableGroups.length === 0) return [];

	return execute('JOIN_ITEMS', () => {
		const joinedByPrimaryId = new Map<string, TimelineItem>();
		const replacementByRemovedId = new Map<string, string>();
		for (const group of joinableGroups) {
			const sorted = group.toSorted((left, right) => left.from - right.from);
			const joined = joinedTimelineItem(sorted);
			if (!joined) continue;
			joinedByPrimaryId.set(joined.id, joined);
			for (const removed of sorted.slice(1)) replacementByRemovedId.set(removed.id, joined.id);
		}
		if (joinedByPrimaryId.size === 0) return [];

		timelineStore._setItems(
			timelineStore.items
				.filter((item) => !replacementByRemovedId.has(item.id))
				.map((item) => joinedByPrimaryId.get(item.id) ?? item)
		);
		transitionsStore.setAll(
			transitionsStore.list.flatMap((transition) => {
				const fromItemId =
					replacementByRemovedId.get(transition.fromItemId) ?? transition.fromItemId;
				const toItemId = replacementByRemovedId.get(transition.toItemId) ?? transition.toItemId;
				return fromItemId === toItemId ? [] : [{ ...transition, fromItemId, toItemId }];
			})
		);
		pruneOrphanedTransitions();
		return [...joinedByPrimaryId.keys()];
	});
}

export function duplicateItems(ids: string[]): string[] {
	return execute('DUPLICATE_ITEMS', () => {
		const byId = timelineStore.itemById;
		const duplicateIdBySourceId = new Map<string, string>();
		for (const id of ids) {
			if (byId.has(id)) duplicateIdBySourceId.set(id, crypto.randomUUID());
		}
		const duplicates: TimelineItem[] = [];
		for (const id of ids) {
			const item = byId.get(id);
			const duplicateId = duplicateIdBySourceId.get(id);
			if (!item || !duplicateId) continue;
			duplicates.push({
				...snapshotTimelineState(item),
				...clonePropertyRuntime(item, duplicateIdBySourceId),
				id: duplicateId,
				originId: item.originId ?? item.id,
				from: item.from + item.durationInFrames
			});
		}
		if (duplicates.length > 0) {
			timelineStore._setItems([...timelineStore.items, ...duplicates]);
		}
		return duplicates.map((item) => item.id);
	});
}

export function linkItems(ids: string[]): boolean {
	const items = timelineStore.items;
	if (!canLinkSelection(items, ids)) return false;
	const expandedIds = expandSelectionWithLinkedItems(items, ids);
	const selectedIds = expandedIds.filter((id) => timelineStore.itemById.has(id));
	if (selectedIds.length < 2) return false;

	execute('LINK_ITEMS', () => {
		const linkedGroupId = crypto.randomUUID();
		timelineStore._updateItems(selectedIds.map((id) => ({ id, patch: { linkedGroupId } })));
	});
	return true;
}

export function unlinkItems(ids: string[]): boolean {
	const unlinkIds = new Set<string>();
	for (const id of ids) {
		for (const linkedId of getLinkedItemIds(timelineStore.items, id)) unlinkIds.add(linkedId);
	}
	const linkedIds = [...unlinkIds].filter(
		(id) => timelineStore.itemById.get(id)?.linkedGroupId !== undefined
	);
	if (linkedIds.length === 0) return false;

	execute('UNLINK_ITEMS', () => {
		timelineStore._updateItems(
			linkedIds.map((id) => ({ id, patch: { linkedGroupId: undefined } }))
		);
	});
	return true;
}

/**
 * Split every item crossing `frame` on the given track (or all tracks when
 * undefined). One undo step; keeps selection semantics simple by returning
 * the ids created on the right side.
 */
export function splitAtFrame(frame: number, trackId?: string): { left: string[]; right: string[] } {
	return execute('SPLIT_ITEMS', () => {
		const left: string[] = [];
		const right: string[] = [];
		const targets = timelineStore.items.filter(
			(item) =>
				(!trackId || item.trackId === trackId) &&
				frame > item.from &&
				frame < item.from + item.durationInFrames
		);
		for (const item of targets) {
			const result = timelineStore._splitItem(item.id, frame);
			if (result) {
				left.push(result.leftItem.id);
				right.push(result.rightItem.id);
			}
		}
		return { left, right };
	});
}

export function splitItemsAtFrame(
	frame: number,
	itemIds: string[]
): { left: string[]; right: string[] } {
	return execute('SPLIT_ITEMS', () => {
		const left: string[] = [];
		const right: string[] = [];
		const idSet = new Set(itemIds);
		const targets = timelineStore.items.filter(
			(item) => idSet.has(item.id) && frame > item.from && frame < item.from + item.durationInFrames
		);
		for (const item of targets) {
			const result = timelineStore._splitItem(item.id, frame);
			if (result) {
				left.push(result.leftItem.id);
				right.push(result.rightItem.id);
			}
		}
		return { left, right };
	});
}

/**
 * Split one item at every scene-change frame, right-to-left, as one
 * undoable step. Right-to-left keeps later cut points valid because each
 * split leaves the original id on the shrinking left piece; frames that no
 * longer fall strictly inside it are skipped.
 */
export function splitAtScenes(id: string, frames: number[]): number {
	return execute('SPLIT_AT_SCENES', () => {
		let count = 0;
		for (const frame of [...frames].sort((a, b) => b - a)) {
			if (timelineStore._splitItem(id, frame)) count++;
		}
		return count;
	});
}

export function trimItemStart(id: string, newFrom: number, newSourceStart?: number): boolean {
	return execute('TRIM_ITEM_START', () => {
		const item = timelineStore.itemById.get(id);
		if (!item) return false;
		const delta = newFrom - item.from;
		const nextDuration = item.durationInFrames - delta;
		if (nextDuration <= 0 || delta < 0) return false;
		const patch: Partial<TimelineItem> = {
			from: newFrom,
			durationInFrames: nextDuration
		};
		if ((item.type === 'video' || item.type === 'audio') && newSourceStart !== undefined) {
			patch.sourceStart = newSourceStart;
		}
		timelineStore._updateItems([{ id, patch }]);
		return true;
	});
}

export function trimItemEnd(id: string, newEnd: number, newSourceEnd?: number): boolean {
	return execute('TRIM_ITEM_END', () => {
		const item = timelineStore.itemById.get(id);
		if (!item) return false;
		const nextDuration = newEnd - item.from;
		if (nextDuration <= 0 || newEnd < item.from + 1) return false;
		const patch: Partial<TimelineItem> = { durationInFrames: nextDuration };
		if ((item.type === 'video' || item.type === 'audio') && newSourceEnd !== undefined) {
			patch.sourceEnd = newSourceEnd;
		}
		timelineStore._updateItems([{ id, patch }]);
		return true;
	});
}

/** Ripple delete selected ranges and close them across edited and sync-locked tracks. */
export function rippleDeleteItems(
	ids: string[],
	expandLinked = timelineStore.linkedSelectionEnabled
): string[] {
	const items = timelineStore.items;
	const deletableIds = deletableItemIds(ids, expandLinked);
	if (deletableIds.length === 0) return [];
	const idsToDelete = new Set(deletableIds);
	const removedItems = items.filter((item) => idsToDelete.has(item.id));
	const remainingItems = items.filter((item) => !idsToDelete.has(item.id));
	const editedTrackIds = new Set(removedItems.map((item) => item.trackId));
	const removedIntervals = removedItems.map((item) => ({
		start: item.from,
		end: item.from + item.durationInFrames
	}));

	const baseShiftByItemId = new Map<string, number>();
	for (const item of remainingItems) {
		const shift = removedItems
			.filter(
				(removed) =>
					removed.trackId === item.trackId && removed.from + removed.durationInFrames <= item.from
			)
			.reduce((sum, removed) => sum + removed.durationInFrames, 0);
		if (shift > 0) baseShiftByItemId.set(item.id, shift);
	}

	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	const remainingById = new Map(remainingItems.map((item) => [item.id, item]));
	const shiftByItemId = new Map<string, number>();
	for (const [itemId, shift] of baseShiftByItemId) {
		const relatedIds = expandLinked
			? expandSelectionWithLinkedItems(remainingItems, [itemId])
			: [itemId];
		for (const relatedId of relatedIds) {
			const related = remainingById.get(relatedId);
			if (!related || trackById.get(related.trackId)?.locked) continue;
			const handledBySyncLock =
				!editedTrackIds.has(related.trackId) &&
				isTrackSyncLockEnabled(trackById.get(related.trackId));
			if (handledBySyncLock) continue;
			shiftByItemId.set(relatedId, Math.max(shiftByItemId.get(relatedId) ?? 0, shift));
		}
	}

	const updates = remainingItems.flatMap((item) => {
		const shift = shiftByItemId.get(item.id) ?? 0;
		return shift > 0 ? [{ id: item.id, from: Math.max(0, item.from - shift) }] : [];
	});
	const shiftedFromById = new Map(updates.map((update) => [update.id, update.from]));
	const coveredIds: string[] = [];
	for (const item of remainingItems) {
		if (shiftedFromById.has(item.id)) continue;
		const itemEnd = item.from + item.durationInFrames;
		for (const shifted of remainingItems) {
			const newFrom = shiftedFromById.get(shifted.id);
			if (newFrom === undefined || shifted.trackId !== item.trackId) continue;
			if (newFrom < itemEnd && newFrom + shifted.durationInFrames > item.from) {
				coveredIds.push(item.id);
				break;
			}
		}
	}
	const coveredExpanded = deletableItemIds(coveredIds, expandLinked);
	const coveredSet = new Set(coveredExpanded);
	const directRemoveIds = [...new Set([...deletableIds, ...coveredExpanded])];
	const safeUpdates = updates.filter((update) => !coveredSet.has(update.id));

	return execute('RIPPLE_DELETE', () => {
		timelineStore._removeItems(directRemoveIds);
		if (safeUpdates.length > 0) timelineStore._moveItems(safeUpdates);
		const syncLockResult = propagateRemovedIntervalsToSyncLockedTracks({
			editedTrackIds,
			intervals: removedIntervals
		});
		pruneInvalidTransitions();
		return [...new Set([...directRemoveIds, ...syncLockResult.removedIds])];
	});
}

/** Close one gap between neighbors on a track by sliding the right side left. */
export function closeGapAtPosition(trackId: string, position: number): void {
	execute('CLOSE_GAP', () => {
		const trackItems = (timelineStore.itemsByTrackId.get(trackId) ?? [])
			.slice()
			.sort((a, b) => a.from - b.from);
		const leftEnd = Math.max(
			...trackItems
				.filter((i) => i.from + i.durationInFrames <= position)
				.map((i) => i.from + i.durationInFrames),
			0
		);
		const updates: Array<{ id: string; from: number }> = [];
		for (const item of trackItems) {
			if (item.from >= position) {
				updates.push({
					id: item.id,
					from: Math.max(item.from - (position - leftEnd), leftEnd)
				});
			}
		}
		timelineStore._moveItems(updates);
	});
}

export function setInPoint(frame: number | null): void {
	execute('SET_IN_POINT', () => timelineStore._setInPoint(frame));
}

export function setOutPoint(frame: number | null): void {
	execute('SET_OUT_POINT', () => timelineStore._setOutPoint(frame));
}

export function addMarker(frame: number): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute('ADD_MARKER', () => {
		const id = crypto.randomUUID();
		timelineStore._addMarker({ id, frame, color: '#d97746' });
		return id;
	}) as string;
}

export function removeMarker(id: string): void {
	execute('REMOVE_MARKER', () => timelineStore._removeMarker(id));
}

export function updateMarker(
	id: string,
	patch: Partial<{ frame: number; label: string; color: string }>
): boolean {
	if (!timelineStore.markers.some((marker) => marker.id === id)) return false;
	execute('UPDATE_MARKER', () => timelineStore._updateMarker(id, patch));
	return true;
}

export function clearAllMarkers(): boolean {
	if (timelineStore.markers.length === 0) return false;
	execute('CLEAR_MARKERS', () => timelineStore._setMarkers([]));
	timelineStore._setSelectedMarkerId(null);
	return true;
}

export function toggleMarkerAtPlayhead(): void {
	const frame = timelineStore.currentFrame;
	const existing = timelineStore.markers.find((marker) => Math.abs(marker.frame - frame) <= 1);
	if (existing) removeMarker(existing.id);
	else addMarker(frame);
}

/**
 * Slip: shift an item's source window without moving it on the timeline.
 * Delta is clamped so the window stays inside the source material.
 */
export function slipItem(id: string, deltaSourceFrames: number): void {
	execute('SLIP_ITEM', () => {
		const item = timelineStore.itemById.get(id);
		if (!item || (item.type !== 'video' && item.type !== 'audio')) return;
		const start = item.sourceStart ?? 0;
		const end = item.sourceEnd ?? start + item.durationInFrames;
		const limit = (item.sourceDuration ?? end) - (end - start);
		const next = Math.min(Math.max(start + deltaSourceFrames, 0), Math.max(limit, 0));
		timelineStore._updateItems([
			{ id, patch: { sourceStart: next, sourceEnd: next + (end - start) } }
		]);
	});
}

/** Rate-stretch synchronized A/V while keeping the source window and start fixed. */
export function setItemSpeed(id: string, speed: number): boolean {
	const item = timelineStore.itemById.get(id);
	if (!item || (item.type !== 'video' && item.type !== 'audio') || !Number.isFinite(speed)) {
		return false;
	}
	const targets = getSynchronizedLinkedItems(timelineStore.items, id).filter(
		(candidate) => candidate.type === 'video' || candidate.type === 'audio'
	);
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	if (
		targets.length === 0 ||
		targets.some((candidate) => trackById.get(candidate.trackId)?.locked)
	) {
		return false;
	}

	const clamped = clampSpeed(speed);
	if (targets.every((candidate) => Math.abs((candidate.speed ?? 1) - clamped) < 1e-9)) {
		return false;
	}
	execute('SET_ITEM_SPEED', () => {
		const updates = targets.map((candidate) => {
			const sourceFps = candidate.sourceFps ?? timelineStore.fps;
			const currentSpeed = candidate.speed ?? 1;
			const sourceFrames =
				candidate.sourceStart !== undefined && candidate.sourceEnd !== undefined
					? Math.max(1, candidate.sourceEnd - candidate.sourceStart)
					: timelineToSourceFrames(
							candidate.durationInFrames,
							currentSpeed,
							timelineStore.fps,
							sourceFps
						);
			const durationInFrames = Math.max(
				1,
				sourceToTimelineFrames(sourceFrames, clamped, sourceFps, timelineStore.fps)
			);
			return {
				id: candidate.id,
				patch: {
					speed: clamped,
					durationInFrames,
					keyframes: scaleItemKeyframes(
						candidate.keyframes,
						candidate.durationInFrames,
						durationInFrames
					),
					...(candidate.vectorKeyframes && {
						vectorKeyframes: scaleItemVectorKeyframes(
							candidate.vectorKeyframes,
							candidate.durationInFrames,
							durationInFrames
						)
					})
				} satisfies Partial<TimelineItem>
			};
		});
		timelineStore._updateItems(updates);
		pruneInvalidTransitions();
	});
	return true;
}

export function setCurrentFrame(frame: number): void {
	// Playhead moves are not undoable — they're navigation, not edits.
	if (timelineStore.seekLocked) return;
	editorSession.clock.seek(frame);
}
