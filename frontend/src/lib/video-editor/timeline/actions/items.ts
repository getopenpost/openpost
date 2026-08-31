/**
 * Timeline item edit actions. Every public action runs inside `execute`
 * so it lands as one undoable step.
 *
 * Ported from FreeCut (MIT) - item-actions.ts / split-actions.ts and kept
 * aligned with linked selection, transitions, and sync-lock ripple rules.
 */

import type {
	EasingType,
	ShapeType,
	SpeedRampPoint,
	TextStylePresetId,
	TimelineItem
} from '$lib/video-editor/project/types';
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
import { buildTrackGapClosePlan, type TrackGapClosePlan } from '../gap-closing';
import {
	clampSpeed,
	sourceToTimelineFrames,
	timelineToSourceFrames
} from '../utils/source-calculations';
import { DEFAULT_MARKER_COLOR } from '../markers';
import { ensureOpenTrackForRange } from './track-placement';
import {
	findForwardOpenTrackShift,
	updatesIntroduceExclusiveTrackOverlap
} from '../track-occupancy';
import {
	buildTextStylePresetTemplate,
	type TextStylePresetCopy
} from '../../typography/text-style-presets';
import {
	shiftSpeedRampSourceFrames,
	timelineOffsetToSourceFrame,
	variableSpeedDurationInFrames
} from '../source-time-map';

export function addItems(newItems: TimelineItem[]): void {
	execute('ADD_ITEMS', () => {
		timelineStore._setItems([...timelineStore.items, ...newItems]);
	});
}

export function addTextItem(label: string): string {
	return execute('ADD_TEXT_ITEM', () => {
		if (
			!effectiveMediaTracks(timelineStore.tracks).some(
				(track) => track.kind !== 'audio' && !track.locked
			)
		) {
			throw new Error('An unlocked visual track is required to add text.');
		}
		const from = timelineStore.currentFrame;
		const durationInFrames = timelineStore.fps * 3;
		const targetTrack = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'text',
			from,
			durationInFrames,
			label
		});
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: targetTrack.id,
			from,
			durationInFrames,
			label,
			text: label,
			type: 'text'
		});
		return id;
	});
}

export function addTextItemAtFrame(
	label: string,
	frame: number,
	preferredTrackId?: string
): string {
	return execute('ADD_TEXT_ITEM', () => {
		if (
			!effectiveMediaTracks(timelineStore.tracks).some(
				(track) => track.kind !== 'audio' && !track.locked
			)
		) {
			throw new Error('An unlocked visual track is required to add text.');
		}
		const durationInFrames = timelineStore.fps * 3;
		const targetTrack = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'text',
			from: frame,
			durationInFrames,
			label,
			preferredTrackId
		});
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: targetTrack.id,
			from: frame,
			durationInFrames,
			label,
			text: label,
			type: 'text'
		});
		return id;
	});
}

export function addTextTemplateItem(
	presetId: TextStylePresetId,
	copy: TextStylePresetCopy,
	placement: { frame?: number; preferredTrackId?: string } = {}
): string {
	return execute('ADD_TEXT_ITEM', () => {
		if (
			!effectiveMediaTracks(timelineStore.tracks).some(
				(track) => track.kind !== 'audio' && !track.locked
			)
		) {
			throw new Error('An unlocked visual track is required to add text.');
		}
		const from = placement.frame ?? timelineStore.currentFrame;
		const durationInFrames = timelineStore.fps * 3;
		const targetTrack = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'text',
			from,
			durationInFrames,
			label: copy.label,
			preferredTrackId: placement.preferredTrackId
		});
		const projectWidth = editorSession.project?.metadata.width ?? 1920;
		const projectHeight = editorSession.project?.metadata.height ?? 1080;
		const template = buildTextStylePresetTemplate(
			presetId,
			{ width: projectWidth, height: projectHeight },
			1,
			copy
		);
		const id = crypto.randomUUID();
		timelineStore._addItem({
			...template,
			id,
			trackId: targetTrack.id,
			from,
			durationInFrames,
			label: template.label ?? copy.label,
			text: template.text ?? copy.sample.title,
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
			transform: { x: 0, y: 0, width: size, height: size, rotation: 0, opacity: 1 }
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

export interface AddShapeItemStyle {
	fillType?: TimelineItem['fillType'];
	fillColor?: string;
	gradientStartColor?: string;
	gradientEndColor?: string;
	gradientAngle?: number;
	sizeMode?: 'default' | 'canvas';
}

/** Add a styled three-second shape on the top unlocked visual track. */
export function addShapeItem(
	shapeType: ShapeType,
	label = SHAPE_LABELS[shapeType],
	style: AddShapeItemStyle = {},
	placement: { frame?: number; preferredTrackId?: string } = {}
): string {
	return execute('ADD_SHAPE_ITEM', () => {
		if (
			!effectiveMediaTracks(timelineStore.tracks).some(
				(track) => track.kind !== 'audio' && !track.locked
			)
		) {
			throw new Error('An unlocked visual track is required to add a shape.');
		}
		const projectWidth = editorSession.project?.metadata.width ?? 1920;
		const projectHeight = editorSession.project?.metadata.height ?? 1080;
		const size = Math.max(80, Math.round(Math.min(projectWidth, projectHeight) * 0.28));
		const from = placement.frame ?? timelineStore.currentFrame;
		const durationInFrames = timelineStore.fps * 3;
		const targetTrack = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'shape',
			from,
			durationInFrames,
			label,
			preferredTrackId: placement.preferredTrackId
		});
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: targetTrack.id,
			from,
			durationInFrames,
			label,
			type: 'shape',
			shapeType,
			fillType: style.fillType,
			fillColor: style.fillColor ?? '#f97316',
			gradientStartColor: style.gradientStartColor,
			gradientEndColor: style.gradientEndColor,
			gradientAngle: style.gradientAngle,
			fillEnabled: shapeType !== 'path',
			strokeColor: '#ffffff',
			strokeEnabled: shapeType === 'path',
			strokeWidth: 8,
			shapePoints: shapeType === 'star' ? 5 : shapeType === 'polygon' ? 6 : undefined,
			shapeInnerRadius: shapeType === 'star' ? 0.5 : undefined,
			transform: {
				width:
					style.sizeMode === 'canvas' || shapeType === 'path'
						? projectWidth
						: shapeType === 'rectangle' || shapeType === 'ellipse'
							? Math.round(size * 1.35)
							: size,
				height: style.sizeMode === 'canvas' || shapeType === 'path' ? projectHeight : size,
				aspectRatioLocked:
					shapeType !== 'path' && shapeType !== 'rectangle' && shapeType !== 'ellipse'
			}
		});
		return id;
	});
}

export interface AddAdjustmentLayerOptions {
	frame?: number;
	preferredTrackId?: string;
}

/** Add a three-second adjustment layer at the requested timeline position. */
export function addAdjustmentLayer(label: string, options: AddAdjustmentLayerOptions = {}): string {
	return execute('ADD_ADJUSTMENT_LAYER', () => {
		const visualTracks = effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order);
		let topVisualTrack =
			visualTracks.find((track) => track.id === options.preferredTrackId) ?? visualTracks[0];
		if (!topVisualTrack) throw new Error('An unlocked visual track is required.');

		const from = Math.max(0, Math.round(options.frame ?? timelineStore.currentFrame));
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

/**
 * Remove confirmed project-media references even when their timeline tracks are locked.
 * The media deletion workflow owns durability and deliberately keeps this irreversible edit
 * out of command history.
 */
export function removeItemsForMediaDeletion(ids: readonly string[]): string[] {
	const requested = new Set(ids);
	const existingIds = timelineStore.items
		.filter((item) => requested.has(item.id))
		.map((item) => item.id);
	if (existingIds.length === 0) return [];
	detachTransformChildrenForRemoval(existingIds);
	timelineStore._removeItems(existingIds);
	pruneOrphanedTransitions();
	return existingIds;
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
		const shift = findForwardOpenTrackShift(duplicates, timelineStore.items);
		if (shift === null) return [];
		if (shift > 0) {
			for (const duplicate of duplicates) duplicate.from += shift;
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

function splitBlockedItemIds(): Set<string> {
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	const blocked = new Set(
		timelineStore.items.filter((item) => trackById.get(item.trackId)?.locked).map((item) => item.id)
	);
	for (const item of timelineStore.items) {
		if (item.captionSource?.type === 'transcript' && trackById.get(item.trackId)?.locked) {
			blocked.add(item.captionSource.clipId);
		}
	}
	return blocked;
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
		const blockedIds = splitBlockedItemIds();
		const targets = timelineStore.items
			.filter(
				(item) =>
					(!trackId || item.trackId === trackId) &&
					!blockedIds.has(item.id) &&
					frame > item.from &&
					frame < item.from + item.durationInFrames
			)
			.toSorted(
				(left, right) =>
					Number(left.captionSource?.type === 'transcript') -
					Number(right.captionSource?.type === 'transcript')
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
		const blockedIds = splitBlockedItemIds();
		const targets = timelineStore.items
			.filter(
				(item) =>
					idSet.has(item.id) &&
					!blockedIds.has(item.id) &&
					frame > item.from &&
					frame < item.from + item.durationInFrames
			)
			.toSorted(
				(left, right) =>
					Number(left.captionSource?.type === 'transcript') -
					Number(right.captionSource?.type === 'transcript')
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
		const source = timelineStore.itemById.get(id);
		if (!source || splitBlockedItemIds().has(source.id)) return 0;
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
		const patch: Partial<TimelineItem> = { from: newFrom, durationInFrames: nextDuration };
		if ((item.type === 'video' || item.type === 'audio') && newSourceStart !== undefined) {
			patch.sourceStart = newSourceStart;
		}
		timelineStore._updateItems([{ id, patch }]);
		return true;
	});
}

export function trimItemEnd(id: string, newEnd: number, newSourceEnd?: number): boolean {
	const item = timelineStore.itemById.get(id);
	if (!item) return false;
	const nextDuration = newEnd - item.from;
	if (nextDuration <= 0 || newEnd < item.from + 1) return false;
	const patch: Partial<TimelineItem> = { durationInFrames: nextDuration };
	if ((item.type === 'video' || item.type === 'audio') && newSourceEnd !== undefined) {
		patch.sourceEnd = newSourceEnd;
	}
	const updates = [{ id, patch }];
	if (updatesIntroduceExclusiveTrackOverlap(timelineStore.items, updates)) return false;
	return execute('TRIM_ITEM_END', () => {
		timelineStore._updateItems(updates);
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

interface ResolvedTrackGapClosePlan extends TrackGapClosePlan {
	updates: Array<{ id: string; from: number }>;
}

function resolveTrackGapClosePlan(
	trackId: string,
	frame: number | undefined
): ResolvedTrackGapClosePlan | null {
	const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
	const targetTrack = effectiveTracks.find((track) => track.id === trackId);
	if (!targetTrack || targetTrack.locked) return null;
	const plan = buildTrackGapClosePlan(timelineStore.items, trackId, frame);
	if (!plan) return null;
	const updatesById = new Map(plan.updates.map((update) => [update.id, update]));
	const linkedUpdateIds = new Set<string>();

	if (timelineStore.linkedSelectionEnabled) {
		const effectiveTracksById = new Map(effectiveTracks.map((track) => [track.id, track]));
		for (const update of plan.updates) {
			const anchor = timelineStore.itemById.get(update.id);
			if (!anchor) continue;
			const shift = anchor.from - update.from;
			for (const companion of getSynchronizedLinkedItems(timelineStore.items, anchor.id)) {
				if (companion.id === anchor.id || companion.trackId === trackId) continue;
				const companionTrack = effectiveTracksById.get(companion.trackId);
				if (companionTrack?.locked) return null;
				if (isTrackSyncLockEnabled(companionTrack)) continue;
				updatesById.set(companion.id, {
					id: companion.id,
					from: Math.max(0, companion.from - shift)
				});
				linkedUpdateIds.add(companion.id);
			}
		}
	}

	const updates = [...updatesById.values()];
	const nextFromById = new Map(updates.map((update) => [update.id, update.from]));
	for (const movedId of linkedUpdateIds) {
		const moved = timelineStore.itemById.get(movedId);
		if (!moved) continue;
		const movedFrom = nextFromById.get(moved.id);
		if (movedFrom === undefined) continue;
		for (const other of timelineStore.items) {
			if (other.id === moved.id || other.trackId !== moved.trackId) continue;
			const otherFrom = nextFromById.get(other.id) ?? other.from;
			const overlapsAfter =
				movedFrom < otherFrom + other.durationInFrames &&
				movedFrom + moved.durationInFrames > otherFrom;
			const overlappedBefore =
				moved.from < other.from + other.durationInFrames &&
				moved.from + moved.durationInFrames > other.from;
			if (overlapsAfter && !overlappedBefore) return null;
		}
	}
	return { ...plan, updates };
}

export function canCloseGapAtPosition(trackId: string, frame: number): boolean {
	return resolveTrackGapClosePlan(trackId, frame) !== null;
}

export function canCloseAllGapsOnTrack(trackId: string): boolean {
	return resolveTrackGapClosePlan(trackId, undefined) !== null;
}

function closeTrackGapPlan(
	trackId: string,
	frame: number | undefined,
	command: 'CLOSE_GAP' | 'CLOSE_ALL_GAPS'
): boolean {
	const plan = resolveTrackGapClosePlan(trackId, frame);
	if (!plan) return false;

	return execute(
		command,
		() => {
			timelineStore._moveItems(plan.updates);
			propagateRemovedIntervalsToSyncLockedTracks({
				editedTrackIds: new Set([trackId]),
				intervals: plan.intervals
			});
			pruneInvalidTransitions();
			return true;
		},
		frame === undefined ? { trackId } : { trackId, frame: Math.max(0, Math.round(frame)) }
	);
}

/** Close the bounded gap under a frame and ripple the same interval through sync-locked tracks. */
export function closeGapAtPosition(trackId: string, frame: number): boolean {
	return closeTrackGapPlan(trackId, frame, 'CLOSE_GAP');
}

/** Close every bounded gap on one track as a single undoable ripple edit. */
export function closeAllGapsOnTrack(trackId: string): boolean {
	return closeTrackGapPlan(trackId, undefined, 'CLOSE_ALL_GAPS');
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
		timelineStore._addMarker({ id, frame, color: DEFAULT_MARKER_COLOR });
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

export function selectMarker(id: string): boolean {
	const marker = timelineStore.markers.find((candidate) => candidate.id === id);
	if (!marker) return false;
	timelineStore._setSelectedMarkerId(id);
	setCurrentFrame(marker.frame);
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
		const sourceDelta = next - start;
		const patch: Partial<TimelineItem> = {
			sourceStart: next,
			sourceEnd: next + (end - start)
		};
		if (item.speedRamp?.length) {
			patch.speedRamp = shiftSpeedRampSourceFrames(item.speedRamp, sourceDelta);
		}
		timelineStore._updateItems([
			{
				id,
				patch
			}
		]);
	});
}

function buildRateStretchUpdates(targets: readonly TimelineItem[], speed: number) {
	return targets.map((candidate) => {
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
			sourceToTimelineFrames(sourceFrames, speed, sourceFps, timelineStore.fps)
		);
		return {
			id: candidate.id,
			patch: {
				speed,
				speedRamp: undefined,
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
	if (
		targets.every(
			(candidate) =>
				Math.abs((candidate.speed ?? 1) - clamped) < 1e-9 &&
				(candidate.speedRamp?.length ?? 0) === 0
		)
	) {
		return false;
	}
	const updates = buildRateStretchUpdates(targets, clamped);
	if (updatesIntroduceExclusiveTrackOverlap(timelineStore.items, updates)) return false;
	execute('SET_ITEM_SPEED', () => {
		timelineStore._updateItems(updates);
		pruneInvalidTransitions();
	});
	return true;
}

export interface SetItemsSpeedResult {
	changed: number;
	locked: number;
	noop: number;
}

export function setItemsSpeed(itemIds: string[], speed: number): SetItemsSpeedResult {
	return execute('SET_ITEMS_SPEED', () => setItemsSpeedLive(itemIds, speed));
}

/** Apply a rate stretch during an inspector gesture without growing undo history. */
export function setItemsSpeedLive(itemIds: string[], speed: number): SetItemsSpeedResult {
	const clamped = clampSpeed(speed);
	if (!Number.isFinite(clamped)) return { changed: 0, locked: 0, noop: 0 };
	const expanded = new Map<string, TimelineItem>();
	for (const id of itemIds) {
		const item = timelineStore.itemById.get(id);
		if (!item || (item.type !== 'video' && item.type !== 'audio')) continue;
		const group = getSynchronizedLinkedItems(timelineStore.items, id).filter(
			(candidate) => candidate.type === 'video' || candidate.type === 'audio'
		);
		for (const candidate of group.length > 0 ? group : [item])
			expanded.set(candidate.id, candidate);
	}
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	let locked = 0;
	let noop = 0;
	const toUpdate: TimelineItem[] = [];
	for (const candidate of expanded.values()) {
		if (trackById.get(candidate.trackId)?.locked) {
			locked++;
			continue;
		}
		if (
			Math.abs((candidate.speed ?? 1) - clamped) < 1e-9 &&
			(candidate.speedRamp?.length ?? 0) === 0
		) {
			noop++;
			continue;
		}
		toUpdate.push(candidate);
	}
	if (toUpdate.length === 0) return { changed: 0, locked, noop };
	if (locked > 0) return { changed: 0, locked, noop };
	const updates = buildRateStretchUpdates(toUpdate, clamped);
	if (updatesIntroduceExclusiveTrackOverlap(timelineStore.items, updates)) {
		return { changed: 0, locked, noop: 0 };
	}
	timelineStore._updateItems(updates);
	pruneInvalidTransitions();
	return { changed: toUpdate.length, locked, noop };
}

export interface SpeedRampEditResult {
	changed: string[];
	locked: number;
	pointId?: string;
}

interface SpeedRampTargets {
	targets: TimelineItem[];
	locked: number;
}

function speedRampTargets(itemIds: string[]): SpeedRampTargets {
	const expanded = new Map<string, TimelineItem>();
	for (const id of itemIds) {
		const item = timelineStore.itemById.get(id);
		if (!item || (item.type !== 'video' && item.type !== 'audio')) continue;
		const synchronized = getSynchronizedLinkedItems(timelineStore.items, id).filter(
			(candidate) => candidate.type === 'video' || candidate.type === 'audio'
		);
		for (const candidate of synchronized) {
			if (candidate.type === 'video' || candidate.type === 'audio') {
				expanded.set(candidate.id, candidate);
			}
		}
		if (synchronized.length === 0) expanded.set(item.id, item);
	}
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	const targets = [...expanded.values()];
	return {
		targets,
		locked: targets.filter((candidate) => trackById.get(candidate.trackId)?.locked).length
	};
}

function speedRampUpdate(
	candidate: TimelineItem,
	speedRamp: SpeedRampPoint[]
): Partial<TimelineItem> {
	const nextItem = { ...candidate, speedRamp };
	const durationInFrames = Math.max(
		1,
		Math.round(variableSpeedDurationInFrames(nextItem, timelineStore.fps))
	);
	return {
		speedRamp,
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
	};
}

/** Add one source-anchored speed point at an absolute timeline frame. */
export function addItemsSpeedPoint(itemIds: string[], timelineFrame: number): SpeedRampEditResult {
	const { targets, locked } = speedRampTargets(itemIds);
	if (targets.length === 0 || locked > 0) return { changed: [], locked };
	const pointId = crypto.randomUUID();
	const startId = crypto.randomUUID();
	const endId = crypto.randomUUID();
	const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
	for (const candidate of targets) {
		if (
			timelineFrame < candidate.from ||
			timelineFrame > candidate.from + candidate.durationInFrames
		) {
			continue;
		}
		const sourceStart = candidate.sourceStart ?? 0;
		const sourceEnd = candidate.sourceEnd;
		if (sourceEnd === undefined || sourceEnd <= sourceStart) continue;
		const sourceFrame = Math.max(
			sourceStart,
			Math.min(
				sourceEnd,
				Math.round(
					timelineOffsetToSourceFrame(candidate, timelineFrame - candidate.from, timelineStore.fps)
				)
			)
		);
		const existing = candidate.speedRamp ?? [];
		if (existing.some((point) => point.sourceFrame === sourceFrame)) continue;
		const baseSpeed = candidate.speed ?? 1;
		const initial =
			existing.length > 0
				? existing
				: [
						{
							id: sourceFrame === sourceStart ? pointId : startId,
							sourceFrame: sourceStart,
							speed: baseSpeed,
							easing: 'linear' as const
						},
						{
							id: sourceFrame === sourceEnd ? pointId : endId,
							sourceFrame: sourceEnd,
							speed: baseSpeed,
							easing: 'linear' as const
						}
					];
		const speedRamp = initial.some((point) => point.sourceFrame === sourceFrame)
			? initial
			: [
					...initial,
					{ id: pointId, sourceFrame, speed: baseSpeed, easing: 'linear' as const }
				].sort((left, right) => left.sourceFrame - right.sourceFrame);
		updates.push({ id: candidate.id, patch: speedRampUpdate(candidate, speedRamp) });
	}
	if (updates.length === 0) return { changed: [], locked, pointId };
	execute('ADD_ITEMS_SPEED_POINT', () => {
		timelineStore._updateItems(updates);
		pruneInvalidTransitions();
	});
	return { changed: updates.map((update) => update.id), locked, pointId };
}

export function updateItemsSpeedPoint(
	itemIds: string[],
	pointId: string,
	patch: { speed?: number; easing?: EasingType }
): SpeedRampEditResult {
	const { targets, locked } = speedRampTargets(itemIds);
	if (targets.length === 0 || locked > 0) return { changed: [], locked, pointId };
	const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
	for (const candidate of targets) {
		const current = candidate.speedRamp ?? [];
		const currentPoint = current.find((point) => point.id === pointId);
		if (!currentPoint) continue;
		const nextSpeed = patch.speed === undefined ? currentPoint.speed : clampSpeed(patch.speed);
		const nextEasing = patch.easing ?? currentPoint.easing;
		if (nextSpeed === currentPoint.speed && nextEasing === currentPoint.easing) continue;
		const speedRamp = current.map((point) =>
			point.id === pointId ? { ...point, speed: nextSpeed, easing: nextEasing } : point
		);
		updates.push({ id: candidate.id, patch: speedRampUpdate(candidate, speedRamp) });
	}
	if (updates.length === 0) return { changed: [], locked, pointId };
	execute('UPDATE_ITEMS_SPEED_POINT', () => {
		timelineStore._updateItems(updates);
		pruneInvalidTransitions();
	});
	return { changed: updates.map((update) => update.id), locked, pointId };
}

export function removeItemsSpeedPoint(itemIds: string[], pointId: string): SpeedRampEditResult {
	const { targets, locked } = speedRampTargets(itemIds);
	if (targets.length === 0 || locked > 0) return { changed: [], locked, pointId };
	const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
	for (const candidate of targets) {
		const current = candidate.speedRamp ?? [];
		const speedRamp = current.filter((point) => point.id !== pointId);
		if (speedRamp.length === current.length) continue;
		updates.push({ id: candidate.id, patch: speedRampUpdate(candidate, speedRamp) });
	}
	if (updates.length === 0) return { changed: [], locked, pointId };
	execute('REMOVE_ITEMS_SPEED_POINT', () => {
		timelineStore._updateItems(updates);
		pruneInvalidTransitions();
	});
	return { changed: updates.map((update) => update.id), locked, pointId };
}

export interface SetItemsVolumeResult {
	changed: number;
	locked: number;
}

export function setItemsVolume(itemIds: string[], volume: number): SetItemsVolumeResult {
	const clamped = Math.max(0, Math.min(1, volume));
	if (!Number.isFinite(clamped)) return { changed: 0, locked: 0 };
	const expanded = new Map<string, TimelineItem>();
	for (const id of itemIds) {
		const item = timelineStore.itemById.get(id);
		if (!item || (item.type !== 'video' && item.type !== 'audio')) continue;
		const group = getSynchronizedLinkedItems(timelineStore.items, id).filter(
			(candidate) => candidate.type === 'video' || candidate.type === 'audio'
		);
		for (const candidate of group.length > 0 ? group : [item])
			expanded.set(candidate.id, candidate);
	}
	const trackById = new Map(
		effectiveMediaTracks(timelineStore.tracks).map((track) => [track.id, track])
	);
	let locked = 0;
	const toUpdate: TimelineItem[] = [];
	for (const candidate of expanded.values()) {
		if (trackById.get(candidate.trackId)?.locked) {
			locked++;
			continue;
		}
		toUpdate.push(candidate);
	}
	if (toUpdate.length === 0) return { changed: 0, locked };
	if (locked > 0) return { changed: 0, locked };
	execute('SET_ITEMS_VOLUME', () => {
		timelineStore._updateItems(
			toUpdate.map((candidate) => ({
				id: candidate.id,
				patch: { volume: clamped }
			}))
		);
	});
	return { changed: toUpdate.length, locked };
}

export function setCurrentFrame(frame: number): void {
	// Playhead moves are not undoable — they're navigation, not edits.
	if (timelineStore.seekLocked) return;
	editorSession.clock.seek(frame);
}
