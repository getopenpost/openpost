/**
 * Keyframe animation actions and interpolation for timeline items.
 *
 * Keyframe tracks are parallel frame/value arrays stored on the item
 * (`item.keyframes[property]`), so undo/redo captures them through the
 * regular snapshot clone. Frames are relative to item start; interpolation
 * applies the outgoing easing stored on the previous keyframe and clamps
 * outside the keyed range.
 *
 * Ported from FreeCut (MIT) - types/keyframe.ts and
 * features/keyframes/utils/interpolation.ts.
 */

import type {
	EasingConfig,
	EasingType,
	ItemKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	SpatialBezierTangents,
	TimelineItem,
	VectorKeyframe,
	VectorKeyframeProperty
} from '$lib/video-editor/project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { isFrameInTransitionRegion } from '../edit-constraints';
import { transitionsStore } from './transitions-store.svelte';
import { legacyKeyframeId, trackEntryAt, type KeyframeRef } from '../keyframe-editor';
import {
	activeVectorKeyframes,
	activePositionKeyframes,
	baseVectorValue,
	cloneVectorKeyframe,
	defaultSpatialTangents,
	interpolateVector,
	interpolatePosition,
	promoteVectorKeyframes,
	promotePositionKeyframes,
	scalarToVectorComponent,
	upsertVectorKeyframe,
	upsertPositionKeyframe,
	VECTOR_COMPONENTS,
	vectorPropertyForComponent,
	vectorPropertyKeyframesPatch,
	vectorKeyframesPatch
} from '../vector-keyframes';
import { isTrackEffectivelyLocked } from '../utils/track-groups';
import {
	effectPropertyPatch,
	isEffectKeyframeProperty
} from '$lib/video-editor/effects/effect-keyframes';
import {
	clonePathVertices,
	isPathVertexKeyframeProperty,
	setPathVertexPropertyValue
} from '../path-vertex-keyframes';
export { activeValueAt, interpolateAt } from '../keyframe-interpolation';

export interface KeyframeEdit {
	ref: KeyframeRef;
	frame: number;
	value: number;
}

export interface KeyframeInsert {
	property: KeyframeProperty;
	frame: number;
	value: number;
	easing?: EasingType;
	easingConfig?: EasingConfig;
	vectorGroupId?: string;
	spatial?: SpatialBezierTangents;
}

export type KeyframeClearProperty = KeyframeProperty | VectorKeyframeProperty;

export interface KeyframeClearOption {
	property: KeyframeClearProperty;
	keyframeCount: number;
}

export interface ClearKeyframesResult {
	changedItemIds: string[];
	lockedItemIds: string[];
	keyframesRemoved: number;
}

function canWriteKeyframe(item: TimelineItem, relativeFrame: number): boolean {
	return (
		Number.isInteger(relativeFrame) &&
		relativeFrame >= 0 &&
		relativeFrame < item.durationInFrames &&
		!isFrameInTransitionRegion(relativeFrame, item, transitionsStore.list)
	);
}

/** Insert or replace a keyframe at exactly `frame` as one undoable step. */
export function setKeyframe(
	itemId: string,
	property: KeyframeProperty,
	frame: number,
	value: number
): boolean {
	return execute('SET_KEYFRAME', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || !canWriteKeyframe(item, frame)) return false;
		const vector = vectorProxyForItem(item, property);
		if (vector) {
			const promoted = promoteVectorKeyframes(item, vector.property, frame);
			if (!promoted) return false;
			remapPromotedSelection(itemId, promoted.identityRemap);
			const current =
				interpolateVector(promoted.keyframes, frame) ?? baseVectorValue(item, vector.property);
			const keyframes = upsertVectorKeyframe(promoted.keyframes, frame, {
				...current,
				[vector.axis]: scalarToVectorComponent(item, vector.property, vector.axis, value)
			});
			timelineStore._updateItems([
				{ id: itemId, patch: vectorPropertyKeyframesPatch(item, vector.property, keyframes) }
			]);
			return true;
		}
		const nextKeyframes = upsertTrack(item.keyframes ?? {}, property, frame, value);
		timelineStore._updateItems([{ id: itemId, patch: { keyframes: nextKeyframes } }]);
		return true;
	});
}

/**
 * Commit an inspector or gizmo value using FreeCut's auto-key rules.
 * Existing animation lanes keep receiving keys. The explicit auto-key flag
 * only controls whether a new lane starts.
 */
export function setAnimatedProperty(
	itemId: string,
	property: KeyframeProperty,
	absoluteFrame: number,
	value: number,
	autoKeyEnabled: boolean
): boolean {
	return execute('SET_ANIMATED_PROPERTY', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const frameIsInsideItem =
			absoluteFrame >= item.from && absoluteFrame < item.from + item.durationInFrames;
		const relativeFrame = absoluteFrame - item.from;
		const track = item.keyframes?.[property];
		const vector = vectorProxyForItem(item, property);
		const hasVector = vector ? Boolean(activeVectorKeyframes(item, vector.property)) : false;
		if (vector && (hasVector || track || autoKeyEnabled)) {
			if (!frameIsInsideItem) return false;
			if (!canWriteKeyframe(item, relativeFrame)) return false;
			const promoted = promoteVectorKeyframes(item, vector.property, relativeFrame);
			if (!promoted) return false;
			remapPromotedSelection(itemId, promoted.identityRemap);
			const current =
				interpolateVector(promoted.keyframes, relativeFrame) ??
				baseVectorValue(item, vector.property);
			const keyframes = upsertVectorKeyframe(promoted.keyframes, relativeFrame, {
				...current,
				[vector.axis]: scalarToVectorComponent(item, vector.property, vector.axis, value)
			});
			timelineStore._updateItems([
				{ id: itemId, patch: vectorPropertyKeyframesPatch(item, vector.property, keyframes) }
			]);
			return true;
		}
		if (track || autoKeyEnabled) {
			if (!frameIsInsideItem) return false;
			if (!canWriteKeyframe(item, relativeFrame)) return false;
			const nextKeyframes = upsertTrack(item.keyframes ?? {}, property, relativeFrame, value);
			timelineStore._updateItems([{ id: itemId, patch: { keyframes: nextKeyframes } }]);
			return true;
		}
		timelineStore._updateItems([{ id: itemId, patch: basePropertyPatch(item, property, value) }]);
		return true;
	});
}

/** Commit several inspector or gizmo values as one undo entry. */
export function setAnimatedProperties(
	itemId: string,
	absoluteFrame: number,
	values: Partial<Record<KeyframeProperty, number>>,
	isAutoKeyEnabled: (property: KeyframeProperty) => boolean
): boolean {
	return execute('SET_ANIMATED_PROPERTIES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || absoluteFrame < item.from || absoluteFrame >= item.from + item.durationInFrames) {
			return false;
		}
		let keyframes = item.keyframes;
		let patch: Partial<TimelineItem> = {};
		const relativeFrame = absoluteFrame - item.from;
		const vectorWrites = new Set<VectorKeyframeProperty>();
		for (const vectorProperty of ['position', 'scale', 'anchor'] as const) {
			const [xProperty, yProperty] = VECTOR_COMPONENTS[vectorProperty];
			const hasValue = values[xProperty] !== undefined || values[yProperty] !== undefined;
			if (!hasValue || !vectorProxyForItem(item, xProperty)) continue;
			if (
				activeVectorKeyframes(item, vectorProperty) ||
				item.keyframes?.[xProperty] ||
				item.keyframes?.[yProperty] ||
				(values[xProperty] !== undefined && isAutoKeyEnabled(xProperty)) ||
				(values[yProperty] !== undefined && isAutoKeyEnabled(yProperty))
			) {
				vectorWrites.add(vectorProperty);
			}
		}
		const shouldWriteKey = Object.entries(values).some(([rawProperty, value]) => {
			if (value === undefined) return false;
			// SAFETY: values is keyed by KeyframeProperty at the public boundary.
			const property = rawProperty as KeyframeProperty;
			const vector = vectorProxyForItem(item, property);
			return (
				Boolean(vector && vectorWrites.has(vector.property)) ||
				item.keyframes?.[property] !== undefined ||
				isAutoKeyEnabled(property)
			);
		});
		if (shouldWriteKey && !canWriteKeyframe(item, relativeFrame)) return false;
		let workingItem = item;
		for (const vectorProperty of vectorWrites) {
			const promoted = promoteVectorKeyframes(workingItem, vectorProperty, relativeFrame);
			if (!promoted) return false;
			remapPromotedSelection(itemId, promoted.identityRemap);
			const [xProperty, yProperty] = VECTOR_COMPONENTS[vectorProperty];
			const current =
				interpolateVector(promoted.keyframes, relativeFrame) ??
				baseVectorValue(workingItem, vectorProperty);
			const vectorKeyframes = upsertVectorKeyframe(promoted.keyframes, relativeFrame, {
				x:
					values[xProperty] === undefined
						? current.x
						: scalarToVectorComponent(workingItem, vectorProperty, 'x', values[xProperty]),
				y:
					values[yProperty] === undefined
						? current.y
						: scalarToVectorComponent(workingItem, vectorProperty, 'y', values[yProperty])
			});
			const vectorPatch = vectorPropertyKeyframesPatch(
				workingItem,
				vectorProperty,
				vectorKeyframes
			);
			patch = { ...patch, ...vectorPatch };
			workingItem = { ...item, ...patch };
			keyframes = patch.keyframes;
		}
		for (const [rawProperty, value] of Object.entries(values)) {
			if (value === undefined) continue;
			// SAFETY: values is keyed by KeyframeProperty at the public boundary.
			const property = rawProperty as KeyframeProperty;
			const vector = vectorProxyForItem(item, property);
			if (vector && vectorWrites.has(vector.property)) continue;
			if (item.keyframes?.[property] || isAutoKeyEnabled(property)) {
				keyframes = upsertTrack(keyframes ?? {}, property, relativeFrame, value);
			} else {
				patch = mergeItemPatches(patch, basePropertyPatch({ ...item, ...patch }, property, value));
			}
		}
		if (keyframes !== item.keyframes) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

/**
 * Edit a position-path point as one atomic X/Y operation. Once either axis has
 * position animation, both axes receive a key so the point remains a vector.
 */
export function setPositionAtFrame(
	itemId: string,
	absoluteFrame: number,
	x: number,
	y: number
): boolean {
	return execute('SET_POSITION_AT_FRAME', () => {
		const item = timelineStore.itemById.get(itemId);
		if (
			!item ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			absoluteFrame < item.from ||
			absoluteFrame >= item.from + item.durationInFrames
		)
			return false;
		const relativeFrame = absoluteFrame - item.from;
		if (!canWriteKeyframe(item, relativeFrame)) return false;
		const hasPositionAnimation = Boolean(
			activePositionKeyframes(item) || item.keyframes?.x || item.keyframes?.y
		);
		if (!hasPositionAnimation) {
			timelineStore._updateItems([
				{ id: itemId, patch: { transform: { ...item.transform, x, y } } }
			]);
			return true;
		}
		const promoted = promotePositionKeyframes(item, relativeFrame);
		if (!promoted) return false;
		remapPromotedSelection(itemId, promoted.identityRemap);
		const position = upsertPositionKeyframe(promoted.position, relativeFrame, {
			x,
			y
		});
		timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
		return true;
	});
}

/** Add smooth spatial handles to an existing position point. */
export function createPositionSpatialTangents(itemId: string, absoluteFrame: number): boolean {
	return execute('CREATE_POSITION_SPATIAL_TANGENTS', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const relativeFrame = absoluteFrame - item.from;
		if (!canWriteKeyframe(item, relativeFrame)) return false;
		const promoted = promotePositionKeyframes(item);
		if (!promoted) return false;
		remapPromotedSelection(itemId, promoted.identityRemap);
		const index = promoted.position.findIndex((keyframe) => keyframe.frame === relativeFrame);
		if (index < 0) return false;
		const spatial = defaultSpatialTangents(promoted.position, index);
		if (!spatial) return false;
		const position = promoted.position.map((keyframe, keyframeIndex) =>
			keyframeIndex === index ? { ...keyframe, spatial } : keyframe
		);
		timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
		return true;
	});
}

/** Commit a spatial-handle drag as one undoable edit. */
export function setPositionSpatialTangents(
	itemId: string,
	absoluteFrame: number,
	spatial: SpatialBezierTangents
): boolean {
	return execute('SET_POSITION_SPATIAL_TANGENTS', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const relativeFrame = absoluteFrame - item.from;
		if (!canWriteKeyframe(item, relativeFrame)) return false;
		const position = activePositionKeyframes(item)?.map(cloneVectorKeyframe);
		if (!position) return false;
		const index = position.findIndex((keyframe) => keyframe.frame === relativeFrame);
		const keyframe = position[index];
		if (!keyframe) return false;
		position[index] = {
			...keyframe,
			spatial: {
				...spatial,
				inTangent: { ...spatial.inTangent },
				outTangent: { ...spatial.outTangent }
			}
		};
		timelineStore._updateItems([{ id: itemId, patch: vectorKeyframesPatch(item, position) }]);
		return true;
	});
}

/** Change the outgoing interpolation for the segment that starts at `frame`. */
export function setKeyframeEasing(
	itemId: string,
	property: KeyframeProperty,
	frame: number,
	easing: EasingType,
	easingConfig?: EasingConfig
): boolean {
	return execute('SET_KEYFRAME_EASING', () => {
		const item = timelineStore.itemById.get(itemId);
		const vector = item ? activeVectorProxy(item, property) : null;
		if (item && vector) {
			const keyframes = vector.keyframes.map(cloneVectorKeyframe);
			const index = keyframes.findIndex((keyframe) => keyframe.frame === frame);
			const keyframe = keyframes[index];
			if (!keyframe) return false;
			const nextKeyframe = { ...keyframe, easing };
			if (easingConfig) nextKeyframe.easingConfig = cloneEasingConfig(easingConfig) ?? undefined;
			else delete nextKeyframe.easingConfig;
			keyframes[index] = nextKeyframe;
			timelineStore._updateItems([
				{
					id: itemId,
					patch: vectorPropertyKeyframesPatch(item, vector.property, keyframes)
				}
			]);
			return true;
		}
		const track = item?.keyframes?.[property];
		if (!item || !track) return false;
		const index = track.frames.indexOf(frame);
		if (index === -1) return false;

		const nextTrack = withCompleteMetadata(track, property);
		nextTrack.easings[index] = easing;
		nextTrack.easingConfigs[index] = easingConfig ?? null;
		timelineStore._updateItems([
			{
				id: itemId,
				patch: { keyframes: { ...item.keyframes, [property]: nextTrack } }
			}
		]);
		return true;
	});
}

/** Change several outgoing interpolations atomically - keeps parallel metadata aligned and records one undo step. */
export function setKeyframeEasings(
	itemId: string,
	updates: ReadonlyArray<{
		property: KeyframeProperty;
		frame: number;
		easing: EasingType;
		easingConfig?: EasingConfig;
	}>
): boolean {
	return execute('SET_KEYFRAME_EASINGS', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || updates.length === 0) return false;
		type EasingUpdate = (typeof updates)[number];
		let vectorPatches: Partial<TimelineItem> = {};
		let scalarKeyframes: ItemKeyframes | undefined = undefined;
		let workingItem: TimelineItem = item;
		const vectorUpdates = new Map<VectorKeyframeProperty, EasingUpdate[]>();
		const scalarUpdates: EasingUpdate[] = [];
		for (const update of updates) {
			const vector = activeVectorProxy(workingItem, update.property);
			if (vector) {
				const group = vectorUpdates.get(vector.property) ?? [];
				group.push(update);
				vectorUpdates.set(vector.property, group);
			} else {
				scalarUpdates.push(update);
			}
		}
		for (const [vectorProperty, group] of vectorUpdates) {
			const source = activeVectorKeyframes(workingItem, vectorProperty);
			if (!source) return false;
			const next = source.map(cloneVectorKeyframe);
			for (const update of group) {
				const index = next.findIndex((keyframe) => keyframe.frame === update.frame);
				if (index < 0) return false;
				const keyframe = next[index];
				if (!keyframe) return false;
				const clonedConfig = update.easingConfig ? cloneEasingConfig(update.easingConfig) : null;
				const updated: VectorKeyframe = { ...keyframe, easing: update.easing };
				if (clonedConfig) updated.easingConfig = clonedConfig;
				else delete updated.easingConfig;
				next[index] = updated;
			}
			vectorPatches = {
				...vectorPatches,
				...vectorPropertyKeyframesPatch(workingItem, vectorProperty, next)
			};
			workingItem = { ...item, ...vectorPatches };
			if (scalarKeyframes) {
				workingItem = { ...workingItem, keyframes: scalarKeyframes };
			}
		}
		if (scalarUpdates.length > 0) {
			const baseKeyframes: ItemKeyframes = {};
			const baseSource = vectorPatches.keyframes ?? item.keyframes;
			if (baseSource) Object.assign(baseKeyframes, baseSource);
			scalarKeyframes = baseKeyframes;
			for (const update of scalarUpdates) {
				const track = scalarKeyframes[update.property];
				if (!track) return false;
				const index = track.frames.indexOf(update.frame);
				if (index === -1) return false;
				const nextTrack = withCompleteMetadata(track, update.property);
				nextTrack.easings[index] = update.easing;
				nextTrack.easingConfigs[index] = update.easingConfig ?? null;
				scalarKeyframes[update.property] = nextTrack;
			}
			vectorPatches.keyframes = scalarKeyframes;
		}
		if (Object.keys(vectorPatches).length === 0) return false;
		timelineStore._updateItems([{ id: itemId, patch: vectorPatches }]);
		return true;
	});
}

/** Remove the keyframe at exactly `frame`; drops empty tracks. One undoable step. */
export function removeKeyframe(itemId: string, property: KeyframeProperty, frame: number): boolean {
	return execute('REMOVE_KEYFRAME', () => {
		const item = timelineStore.itemById.get(itemId);
		const vector = item ? activeVectorProxy(item, property) : null;
		if (item && vector) {
			const keyframes = vector.keyframes.filter((keyframe) => keyframe.frame !== frame);
			if (keyframes.length === vector.keyframes.length) return false;
			timelineStore._updateItems([
				{
					id: itemId,
					patch: vectorPropertyKeyframesPatch(item, vector.property, keyframes)
				}
			]);
			return true;
		}
		const track = item?.keyframes?.[property];
		if (!item || !track) return false;
		const index = track.frames.indexOf(frame);
		if (index === -1) return false;
		const nextTrack: KeyframeTrack = {
			frames: withoutIndex(track.frames, index),
			values: withoutIndex(track.values, index),
			...(track.ids && { ids: withoutIndex(track.ids, index) }),
			...(track.easings && { easings: withoutIndex(track.easings, index) }),
			...(track.easingConfigs && {
				easingConfigs: withoutIndex(track.easingConfigs, index)
			})
		};
		timelineStore._updateItems([
			{
				id: itemId,
				patch: {
					keyframes: pruneTrack(item.keyframes ?? {}, property, nextTrack)
				}
			}
		]);
		return true;
	});
}

/** Move or edit several keyframes as one collision-safe undo step. */
export function updateKeyframes(itemId: string, edits: readonly KeyframeEdit[]): boolean {
	return execute('UPDATE_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || edits.length === 0) return false;
		if (edits.some((edit) => !canWriteKeyframe(item, edit.frame) || !Number.isFinite(edit.value))) {
			return false;
		}

		const vectorEditsByProperty = groupVectorEdits(item, edits);
		const vectorEdits = new Set([...vectorEditsByProperty.values()].flat());
		const scalarEdits = edits.filter((edit) => !vectorEdits.has(edit));
		let patch: Partial<TimelineItem> = {};
		let workingItem = item;
		for (const [vectorProperty, propertyEdits] of vectorEditsByProperty) {
			const source = activeVectorKeyframes(workingItem, vectorProperty);
			if (!source) return false;
			const keyframes = updateVectorKeyframes(source, propertyEdits, vectorProperty);
			if (!keyframes) return false;
			patch = {
				...patch,
				...vectorPropertyKeyframesPatch(workingItem, vectorProperty, keyframes)
			};
			workingItem = { ...item, ...patch };
		}

		const byProperty = Map.groupBy(scalarEdits, (edit) => edit.ref.property);
		const keyframes: ItemKeyframes = { ...(patch.keyframes ?? item.keyframes) };
		for (const [property, propertyEdits] of byProperty) {
			const source = item.keyframes?.[property];
			if (!source) return false;
			const track = withCompleteMetadata(source, property);
			const targets = new Set<number>();
			const editById = new Map<string, KeyframeEdit>();
			for (const edit of propertyEdits) {
				const index = trackEntryAt(track, edit.ref);
				if (index < 0 || targets.has(edit.frame)) return false;
				targets.add(edit.frame);
				const id = track.ids[index];
				if (!id) return false;
				editById.set(id, edit);
			}

			const entries = track.frames.map((frame, index) => {
				const id = track.ids[index] ?? crypto.randomUUID();
				const edit = editById.get(id);
				return {
					id,
					frame: edit?.frame ?? frame,
					value: edit?.value ?? track.values[index] ?? 0,
					easing: track.easings[index] ?? 'linear',
					easingConfig: track.easingConfigs[index] ?? null,
					isEdited: edit !== undefined
				};
			});
			const byFrame = new Map<number, (typeof entries)[number]>();
			for (const entry of entries) {
				const existing = byFrame.get(entry.frame);
				if (!existing || entry.isEdited) byFrame.set(entry.frame, entry);
			}
			const sorted = [...byFrame.values()].toSorted((left, right) => left.frame - right.frame);
			keyframes[property] = {
				frames: sorted.map((entry) => entry.frame),
				values: sorted.map((entry) => entry.value),
				ids: sorted.map((entry) => entry.id),
				easings: sorted.map((entry) => entry.easing),
				easingConfigs: sorted.map((entry) => entry.easingConfig)
			};
		}
		if (scalarEdits.length > 0) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

/** Duplicate keyframes to explicit graph targets, preserving their easing. */
export function duplicateKeyframes(itemId: string, edits: readonly KeyframeEdit[]): boolean {
	return execute('DUPLICATE_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || edits.length === 0) return false;
		if (edits.some((edit) => !canWriteKeyframe(item, edit.frame) || !Number.isFinite(edit.value))) {
			return false;
		}
		const vectorEditsByProperty = groupVectorEdits(item, edits);
		const vectorEdits = new Set([...vectorEditsByProperty.values()].flat());
		const scalarEdits = edits.filter((edit) => !vectorEdits.has(edit));
		let patch: Partial<TimelineItem> = {};
		let workingItem = item;
		for (const [vectorProperty, propertyEdits] of vectorEditsByProperty) {
			const source = activeVectorKeyframes(workingItem, vectorProperty);
			if (!source) return false;
			const keyframes = duplicateVectorKeyframes(source, propertyEdits, vectorProperty);
			if (!keyframes) return false;
			patch = {
				...patch,
				...vectorPropertyKeyframesPatch(workingItem, vectorProperty, keyframes)
			};
			workingItem = { ...item, ...patch };
		}
		let keyframes: ItemKeyframes = { ...(patch.keyframes ?? item.keyframes) };
		for (const edit of scalarEdits) {
			const source = keyframes[edit.ref.property];
			if (!source) return false;
			const track = withCompleteMetadata(source, edit.ref.property);
			const sourceIndex = trackEntryAt(track, edit.ref);
			if (sourceIndex < 0) return false;
			const targetIndex = track.frames.indexOf(edit.frame);
			if (targetIndex >= 0) {
				track.values[targetIndex] = edit.value;
				track.easings[targetIndex] = track.easings[sourceIndex] ?? 'linear';
				track.easingConfigs[targetIndex] = track.easingConfigs[sourceIndex] ?? null;
			} else {
				let insertAt = track.frames.findIndex((frame) => frame > edit.frame);
				if (insertAt < 0) insertAt = track.frames.length;
				track.frames.splice(insertAt, 0, edit.frame);
				track.values.splice(insertAt, 0, edit.value);
				track.ids.splice(insertAt, 0, crypto.randomUUID());
				track.easings.splice(insertAt, 0, track.easings[sourceIndex] ?? 'linear');
				track.easingConfigs.splice(
					insertAt,
					0,
					cloneEasingConfig(track.easingConfigs[sourceIndex] ?? null)
				);
			}
			keyframes = { ...keyframes, [edit.ref.property]: track };
		}
		if (scalarEdits.length > 0) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

/** Insert or replace several clipboard keyframes as one undo step. */
export function insertKeyframes(itemId: string, inserts: readonly KeyframeInsert[]): KeyframeRef[] {
	return execute('INSERT_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || inserts.length === 0) return [];
		if (
			inserts.some(
				(insert) => !canWriteKeyframe(item, insert.frame) || !Number.isFinite(insert.value)
			)
		) {
			return [];
		}

		const refsByInsert = new Map<KeyframeInsert, KeyframeRef>();
		const vectorInsertsByProperty = new Map<VectorKeyframeProperty, KeyframeInsert[]>();
		for (const insert of inserts) {
			const vector = vectorPropertyForComponent(insert.property);
			if (!vector) continue;
			if (!insert.vectorGroupId && !activeVectorKeyframes(item, vector.property)) continue;
			const group = vectorInsertsByProperty.get(vector.property) ?? [];
			group.push(insert);
			vectorInsertsByProperty.set(vector.property, group);
		}
		const vectorInserts = new Set([...vectorInsertsByProperty.values()].flat());
		const scalarInserts = inserts.filter((insert) => !vectorInserts.has(insert));
		let patch: Partial<TimelineItem> = {};
		const writtenVectors = new Map<VectorKeyframeProperty, VectorKeyframe[]>();
		let workingItem = item;
		for (const [vectorProperty, propertyInserts] of vectorInsertsByProperty) {
			const firstFrame = propertyInserts[0]?.frame;
			const promoted = promoteVectorKeyframes(workingItem, vectorProperty, firstFrame);
			if (!promoted) return [];
			remapPromotedSelection(itemId, promoted.identityRemap);
			let vectorKeyframes = promoted.keyframes;
			const groups = new Map<string, KeyframeInsert[]>();
			for (const insert of propertyInserts) {
				const key = `${insert.vectorGroupId ?? 'legacy'}:${insert.frame}`;
				const group = groups.get(key) ?? [];
				group.push(insert);
				groups.set(key, group);
			}
			for (const group of groups.values()) {
				const first = group[0];
				if (!first) continue;
				const current =
					interpolateVector(vectorKeyframes, first.frame) ??
					baseVectorValue(workingItem, vectorProperty);
				vectorKeyframes = upsertVectorKeyframe(vectorKeyframes, first.frame, current);
				const index = vectorKeyframes.findIndex((keyframe) => keyframe.frame === first.frame);
				const keyframe = vectorKeyframes[index];
				if (!keyframe) return [];
				const value = { ...keyframe.value };
				for (const insert of group) {
					const vector = vectorPropertyForComponent(insert.property);
					if (!vector || vector.property !== vectorProperty) continue;
					value[vector.axis] = insert.vectorGroupId
						? insert.value
						: scalarToVectorComponent(workingItem, vectorProperty, vector.axis, insert.value);
				}
				const nextKeyframe: VectorKeyframe = {
					...keyframe,
					value,
					easing: first.easing ?? 'linear'
				};
				if (first.easingConfig)
					nextKeyframe.easingConfig = cloneEasingConfig(first.easingConfig) ?? undefined;
				else delete nextKeyframe.easingConfig;
				if (first.spatial && vectorProperty === 'position') {
					nextKeyframe.spatial = {
						...first.spatial,
						inTangent: { ...first.spatial.inTangent },
						outTangent: { ...first.spatial.outTangent }
					};
				} else delete nextKeyframe.spatial;
				vectorKeyframes[index] = nextKeyframe;
				for (const insert of group) {
					const vector = vectorPropertyForComponent(insert.property);
					if (!vector || vector.property !== vectorProperty) continue;
					refsByInsert.set(insert, {
						property: insert.property,
						frame: insert.frame,
						id: vector.axis === 'x' ? keyframe.id : `${keyframe.id}:y`,
						vectorId: keyframe.id,
						index
					});
				}
			}
			writtenVectors.set(vectorProperty, vectorKeyframes);
			patch = {
				...patch,
				...vectorPropertyKeyframesPatch(workingItem, vectorProperty, vectorKeyframes)
			};
			workingItem = { ...item, ...patch };
		}

		let keyframes: ItemKeyframes = { ...(patch.keyframes ?? item.keyframes) };
		for (const [property, propertyInserts] of Map.groupBy(
			scalarInserts,
			(insert) => insert.property
		)) {
			const track = withCompleteMetadata(
				keyframes[property] ?? {
					frames: [],
					values: [],
					ids: [],
					easings: [],
					easingConfigs: []
				},
				property
			);
			for (const insert of propertyInserts) {
				let index = track.frames.indexOf(insert.frame);
				if (index < 0) {
					index = track.frames.length;
					track.frames.push(insert.frame);
					track.values.push(insert.value);
					track.ids.push(crypto.randomUUID());
					track.easings.push(insert.easing ?? 'linear');
					track.easingConfigs.push(cloneEasingConfig(insert.easingConfig ?? null));
				} else {
					track.values[index] = insert.value;
					track.easings[index] = insert.easing ?? 'linear';
					track.easingConfigs[index] = cloneEasingConfig(insert.easingConfig ?? null);
				}
				refsByInsert.set(insert, {
					property,
					frame: insert.frame,
					id: track.ids[index],
					index
				});
			}

			const indexes = track.frames
				.map((_, index) => index)
				.toSorted((left, right) => track.frames[left] - track.frames[right]);
			keyframes = {
				...keyframes,
				[property]: {
					frames: indexes.map((index) => track.frames[index]),
					values: indexes.map((index) => track.values[index]),
					ids: indexes.map((index) => track.ids[index]),
					easings: indexes.map((index) => track.easings[index]),
					easingConfigs: indexes.map((index) => track.easingConfigs[index])
				}
			};
		}

		if (scalarInserts.length > 0) patch.keyframes = keyframes;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return inserts.flatMap((insert) => {
			const ref = refsByInsert.get(insert);
			if (!ref) return [];
			const sortedIndex = ref.vectorId
				? (writtenVectors
						.get(vectorPropertyForComponent(ref.property)?.property ?? 'position')
						?.findIndex((keyframe) => keyframe.id === ref.vectorId) ?? -1)
				: (keyframes[ref.property]?.ids?.indexOf(ref.id ?? '') ?? -1);
			return [{ ...ref, index: sortedIndex >= 0 ? sortedIndex : ref.index }];
		});
	});
}

function cloneEasingConfig(config: EasingConfig | null): EasingConfig | null {
	if (!config) return null;
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}

/** List every stored animation lane that can be cleared from an item. */
export function keyframeClearOptions(item: TimelineItem): KeyframeClearOption[] {
	const options: KeyframeClearOption[] = [];
	for (const [rawProperty, track] of Object.entries(item.keyframes ?? {})) {
		if (!track || track.frames.length === 0) continue;
		// SAFETY: ItemKeyframes only permits KeyframeProperty keys.
		const property = rawProperty as KeyframeProperty;
		options.push({ property, keyframeCount: track.frames.length });
	}
	for (const property of ['position', 'scale', 'anchor'] as const) {
		const keyframeCount = item.vectorKeyframes?.[property]?.length ?? 0;
		if (keyframeCount > 0) options.push({ property, keyframeCount });
	}
	return options;
}

/** Count stored keys, counting a coupled vector point once rather than once per axis. */
export function keyframeCountForClear(
	item: TimelineItem,
	property?: KeyframeClearProperty
): number {
	const options = keyframeClearOptions(item);
	return options
		.filter((option) => property === undefined || option.property === property)
		.reduce((total, option) => total + option.keyframeCount, 0);
}

/** Clear all animation or one lane across a selection as one undoable command. */
export function clearKeyframesForItems(
	itemIds: readonly string[],
	property?: KeyframeClearProperty
): ClearKeyframesResult {
	return execute('CLEAR_KEYFRAMES_FOR_ITEMS', () => {
		const changedItemIds: string[] = [];
		const lockedItemIds: string[] = [];
		let keyframesRemoved = 0;
		const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
		for (const itemId of new Set(itemIds)) {
			const item = timelineStore.itemById.get(itemId);
			if (!item) continue;
			if (isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) {
				if (keyframeCountForClear(item, property) > 0) lockedItemIds.push(itemId);
				continue;
			}
			const count = keyframeCountForClear(item, property);
			if (count === 0) continue;
			updates.push({ id: itemId, patch: clearKeyframePatch(item, property) });
			changedItemIds.push(itemId);
			keyframesRemoved += count;
		}
		if (updates.length > 0) {
			timelineStore._updateItems(updates);
			keyframeSelectionStore.clear();
		}
		return { changedItemIds, lockedItemIds, keyframesRemoved };
	});
}

function clearKeyframePatch(
	item: TimelineItem,
	property?: KeyframeClearProperty
): Partial<TimelineItem> {
	if (property === undefined) {
		return { keyframes: undefined, vectorKeyframes: undefined };
	}
	if (property === 'position' || property === 'scale' || property === 'anchor') {
		const vectorKeyframes = { ...item.vectorKeyframes };
		delete vectorKeyframes[property];
		return {
			vectorKeyframes: Object.keys(vectorKeyframes).length > 0 ? vectorKeyframes : undefined
		};
	}
	const keyframes: ItemKeyframes = { ...item.keyframes };
	delete keyframes[property];
	return { keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined };
}

/** Remove an arbitrary selection as one undo step. */
export function removeKeyframes(itemId: string, refs: readonly KeyframeRef[]): boolean {
	return execute('REMOVE_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || refs.length === 0) return false;
		const vectorRefsByProperty = groupVectorRefs(item, refs);
		const vectorRefs = new Set([...vectorRefsByProperty.values()].flat());
		let patch: Partial<TimelineItem> = {};
		let workingItem = item;
		for (const [vectorProperty, propertyRefs] of vectorRefsByProperty) {
			const source = activeVectorKeyframes(workingItem, vectorProperty);
			if (!source) continue;
			const vectorIds = new Set(
				propertyRefs.flatMap((ref) => {
					const id = vectorIdForRef(source, ref, vectorProperty);
					return id ? [id] : [];
				})
			);
			const keyframes = source.filter((keyframe) => !vectorIds.has(keyframe.id));
			patch = {
				...patch,
				...vectorPropertyKeyframesPatch(workingItem, vectorProperty, keyframes)
			};
			workingItem = { ...item, ...patch };
		}
		const scalarRefs = refs.filter((ref) => !vectorRefs.has(ref));
		let keyframes = patch.keyframes ?? item.keyframes;
		for (const [property, propertyRefs] of Map.groupBy(scalarRefs, (ref) => ref.property)) {
			const source = keyframes?.[property];
			if (!source) continue;
			const indexes = new Set(
				propertyRefs.map((ref) => trackEntryAt(source, ref)).filter((index) => index >= 0)
			);
			if (indexes.size === 0) continue;
			const keep = source.frames.map((_, index) => index).filter((index) => !indexes.has(index));
			const nextTrack: KeyframeTrack = {
				frames: keep.map((index) => source.frames[index] ?? 0),
				values: keep.map((index) => source.values[index] ?? 0),
				...(source.ids && {
					ids: keep.map((index) => source.ids?.[index] ?? crypto.randomUUID())
				}),
				...(source.easings && {
					easings: keep.map((index) => source.easings?.[index] ?? 'linear')
				}),
				...(source.easingConfigs && {
					easingConfigs: keep.map((index) => source.easingConfigs?.[index] ?? null)
				})
			};
			keyframes = pruneTrack(keyframes ?? {}, property, nextTrack);
		}
		if (keyframes !== (patch.keyframes ?? item.keyframes)) patch.keyframes = keyframes;
		if (Object.keys(patch).length === 0) return false;
		timelineStore._updateItems([{ id: itemId, patch }]);
		return true;
	});
}

function vectorProxyForItem(
	item: TimelineItem,
	property: KeyframeProperty
): { property: VectorKeyframeProperty; axis: 'x' | 'y' } | null {
	const vector = vectorPropertyForComponent(property);
	return vector && !item.separatedVectorProperties?.includes(vector.property) ? vector : null;
}

function activeVectorProxy(
	item: TimelineItem,
	property: KeyframeProperty
): {
	property: VectorKeyframeProperty;
	axis: 'x' | 'y';
	keyframes: readonly VectorKeyframe[];
} | null {
	const vector = vectorProxyForItem(item, property);
	if (!vector) return null;
	const keyframes = activeVectorKeyframes(item, vector.property);
	return keyframes ? { ...vector, keyframes } : null;
}

function groupVectorEdits(
	item: TimelineItem,
	edits: readonly KeyframeEdit[]
): Map<VectorKeyframeProperty, KeyframeEdit[]> {
	const grouped = new Map<VectorKeyframeProperty, KeyframeEdit[]>();
	for (const edit of edits) {
		const vector = activeVectorProxy(item, edit.ref.property);
		if (!vector || !vectorIdForRef(vector.keyframes, edit.ref, vector.property)) continue;
		const group = grouped.get(vector.property) ?? [];
		group.push(edit);
		grouped.set(vector.property, group);
	}
	return grouped;
}

function groupVectorRefs(
	item: TimelineItem,
	refs: readonly KeyframeRef[]
): Map<VectorKeyframeProperty, KeyframeRef[]> {
	const grouped = new Map<VectorKeyframeProperty, KeyframeRef[]>();
	for (const ref of refs) {
		const vector = activeVectorProxy(item, ref.property);
		if (!vector || !vectorIdForRef(vector.keyframes, ref, vector.property)) continue;
		const group = grouped.get(vector.property) ?? [];
		group.push(ref);
		grouped.set(vector.property, group);
	}
	return grouped;
}

function vectorIdForRef(
	keyframes: readonly VectorKeyframe[],
	ref: KeyframeRef,
	property: VectorKeyframeProperty
): string | null {
	const vector = vectorPropertyForComponent(ref.property);
	if (!vector || vector.property !== property) return null;
	const candidate = ref.vectorId ?? (ref.id?.endsWith(':y') ? ref.id.slice(0, -2) : ref.id);
	if (candidate && keyframes.some((keyframe) => keyframe.id === candidate)) return candidate;
	const byIndex = ref.index === undefined ? undefined : keyframes[ref.index];
	if (byIndex?.frame === ref.frame) return byIndex.id;
	return keyframes.find((keyframe) => keyframe.frame === ref.frame)?.id ?? null;
}

function remapPromotedSelection(itemId: string, identityRemap: ReadonlyMap<string, string>): void {
	if (identityRemap.size === 0) return;
	const selected = keyframeSelectionStore.forItem(itemId);
	if (selected.size === 0) return;
	keyframeSelectionStore.replace(
		itemId,
		[...selected].map((id) => identityRemap.get(id) ?? id)
	);
}

function updateVectorKeyframes(
	source: readonly VectorKeyframe[],
	edits: readonly KeyframeEdit[],
	property: VectorKeyframeProperty
): VectorKeyframe[] | null {
	const grouped = new Map<string, KeyframeEdit[]>();
	for (const edit of edits) {
		const id = vectorIdForRef(source, edit.ref, property);
		if (!id) return null;
		const group = grouped.get(id) ?? [];
		group.push(edit);
		grouped.set(id, group);
	}
	const targetFrames = new Set<number>();
	const edited = new Map<string, VectorKeyframe>();
	for (const [id, group] of grouped) {
		const original = source.find((keyframe) => keyframe.id === id);
		if (!original) return null;
		const frames = new Set(group.map((edit) => edit.frame));
		if (frames.size !== 1) return null;
		const frame = group[0]?.frame;
		if (frame === undefined || targetFrames.has(frame)) return null;
		targetFrames.add(frame);
		const value = { ...original.value };
		for (const edit of group) setVectorComponent(value, edit.ref.property, property, edit.value);
		edited.set(id, { ...cloneVectorKeyframe(original), frame, value });
	}
	const byFrame = new Map<number, { keyframe: VectorKeyframe; edited: boolean }>();
	for (const original of source) {
		const next = edited.get(original.id) ?? cloneVectorKeyframe(original);
		const isEdited = edited.has(original.id);
		const existing = byFrame.get(next.frame);
		if (!existing || isEdited) byFrame.set(next.frame, { keyframe: next, edited: isEdited });
	}
	return [...byFrame.values()]
		.map((entry) => entry.keyframe)
		.toSorted((left, right) => left.frame - right.frame);
}

function duplicateVectorKeyframes(
	source: readonly VectorKeyframe[],
	edits: readonly KeyframeEdit[],
	property: VectorKeyframeProperty
): VectorKeyframe[] | null {
	const groups = new Map<string, KeyframeEdit[]>();
	for (const edit of edits) {
		const id = vectorIdForRef(source, edit.ref, property);
		if (!id) return null;
		const key = `${id}:${edit.frame}`;
		const group = groups.get(key) ?? [];
		group.push(edit);
		groups.set(key, group);
	}
	let keyframes = source.map(cloneVectorKeyframe);
	for (const group of groups.values()) {
		const first = group[0];
		if (!first) continue;
		const sourceId = vectorIdForRef(source, first.ref, property);
		const original = source.find((keyframe) => keyframe.id === sourceId);
		if (!original) return null;
		const targetIndex = keyframes.findIndex((keyframe) => keyframe.frame === first.frame);
		const existing = targetIndex >= 0 ? keyframes[targetIndex] : undefined;
		const value = existing?.value ??
			interpolateVector(keyframes, first.frame) ?? { ...original.value };
		const duplicate: VectorKeyframe = {
			...cloneVectorKeyframe(original),
			id: existing?.id ?? crypto.randomUUID(),
			frame: first.frame,
			value: { ...value }
		};
		for (const edit of group) {
			setVectorComponent(duplicate.value, edit.ref.property, property, edit.value);
		}
		if (targetIndex >= 0) keyframes[targetIndex] = duplicate;
		else keyframes.push(duplicate);
		keyframes = keyframes.toSorted((left, right) => left.frame - right.frame);
	}
	return keyframes;
}

function setVectorComponent(
	value: { x: number; y: number },
	component: KeyframeProperty,
	property: VectorKeyframeProperty,
	next: number
): void {
	const vector = vectorPropertyForComponent(component);
	if (!vector || vector.property !== property) return;
	value[vector.axis] = next;
}

function upsertTrack(
	keyframes: ItemKeyframes,
	property: KeyframeProperty,
	frame: number,
	value: number
): ItemKeyframes {
	const source = keyframes[property];
	const complete = withCompleteMetadata(source ?? { frames: [], values: [] }, property);
	const { frames, values, ids, easings, easingConfigs } = complete;
	const index = frames.indexOf(frame);
	if (index !== -1) {
		values[index] = value;
	} else {
		let insertAt = frames.length;
		for (let i = 0; i < frames.length; i++) {
			if (frame < frames[i]) {
				insertAt = i;
				break;
			}
		}
		frames.splice(insertAt, 0, frame);
		values.splice(insertAt, 0, value);
		ids.splice(insertAt, 0, crypto.randomUUID());
		easings.splice(insertAt, 0, 'linear');
		easingConfigs.splice(insertAt, 0, null);
	}
	return {
		...keyframes,
		[property]: { frames, values, ids, easings, easingConfigs }
	};
}

function withCompleteMetadata(
	track: KeyframeTrack,
	property: KeyframeProperty
): Required<KeyframeTrack> {
	return {
		frames: [...track.frames],
		values: [...track.values],
		ids: track.frames.map(
			(frame, index) => track.ids?.[index] ?? legacyKeyframeId(property, frame, index)
		),
		easings: track.frames.map((_, index) => track.easings?.[index] ?? 'linear'),
		easingConfigs: track.frames.map((_, index) => track.easingConfigs?.[index] ?? null)
	};
}

function pruneTrack(
	keyframes: ItemKeyframes,
	property: KeyframeProperty,
	track: KeyframeTrack
): ItemKeyframes | undefined {
	if (track.frames.length > 0) return { ...keyframes, [property]: track };
	const next: ItemKeyframes = { ...keyframes };
	delete next[property];
	return Object.keys(next).length > 0 ? next : undefined;
}

function withoutIndex<T>(source: T[], index: number): T[] {
	return [...source.slice(0, index), ...source.slice(index + 1)];
}

function basePropertyPatch(
	item: TimelineItem,
	property: KeyframeProperty,
	value: number
): Partial<TimelineItem> {
	if (isPathVertexKeyframeProperty(property)) {
		const pathVertices = clonePathVertices(item.pathVertices ?? []);
		return setPathVertexPropertyValue(pathVertices, property, value) ? { pathVertices } : {};
	}
	const effectPatch = effectPropertyPatch(item, property, value);
	if (effectPatch) return effectPatch;
	if (isEffectKeyframeProperty(property)) return {};
	if (
		[
			'x',
			'y',
			'width',
			'height',
			'anchorX',
			'anchorY',
			'rotation',
			'opacity',
			'cornerRadius'
		].includes(property)
	) {
		return { transform: { ...item.transform, [property]: value } };
	}
	const crop = item.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
	if (property.startsWith('crop')) {
		const field = property.slice(4).toLowerCase();
		return { crop: { ...crop, [field]: value } };
	}
	if (property.startsWith('textShadow')) {
		const field = property.slice('textShadow'.length);
		const key = `${field.slice(0, 1).toLowerCase()}${field.slice(1)}`;
		return {
			textShadow: {
				...(item.textShadow ?? {
					blur: 0,
					color: '#000000',
					offsetX: 0,
					offsetY: 0
				}),
				[key]: value
			}
		};
	}
	return { [property]: value };
}

function mergeItemPatches(
	left: Partial<TimelineItem>,
	right: Partial<TimelineItem>
): Partial<TimelineItem> {
	const merged: Partial<TimelineItem> = { ...left, ...right };
	if (left.transform || right.transform) {
		merged.transform = { ...left.transform, ...right.transform };
	}
	if (left.crop || right.crop) {
		merged.crop = {
			top: right.crop?.top ?? left.crop?.top ?? 0,
			right: right.crop?.right ?? left.crop?.right ?? 0,
			bottom: right.crop?.bottom ?? left.crop?.bottom ?? 0,
			left: right.crop?.left ?? left.crop?.left ?? 0,
			softness: right.crop?.softness ?? left.crop?.softness
		};
	}
	if (left.textShadow || right.textShadow) {
		merged.textShadow = {
			blur: right.textShadow?.blur ?? left.textShadow?.blur ?? 0,
			color: right.textShadow?.color ?? left.textShadow?.color ?? '#000000',
			offsetX: right.textShadow?.offsetX ?? left.textShadow?.offsetX ?? 0,
			offsetY: right.textShadow?.offsetY ?? left.textShadow?.offsetY ?? 0
		};
	}
	return merged;
}
