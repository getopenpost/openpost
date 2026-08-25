import type {
	ItemKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	MotionModifier,
	MotionModifierType,
	TimelineItem,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import type { TimelineSnapshot } from '../commands/types';
import type { BakeMotionPlanEntry, BakedMotionKeyframe } from '../bake-motion';
import { buildBakeMotionPlan } from '../bake-motion';
import { captureSnapshot } from '../commands/snapshot.svelte';
import { commandHistory, execute } from '../commands/command-store.svelte';
import { isFrameInTransitionRegion } from '../edit-constraints';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';

export interface MotionModifierAssignment {
	itemId: string;
	modifier: MotionModifier;
}

function withModifier(
	existing: MotionModifier[] | undefined,
	modifier: MotionModifier
): MotionModifier[] {
	return [...(existing ?? []).filter((entry) => entry.type !== modifier.type), modifier];
}

export function applyMotionModifierToItems(assignments: MotionModifierAssignment[]): number {
	if (assignments.length === 0) return 0;
	return execute('APPLY_MOTION_MODIFIERS', () => {
		const updates = assignments.flatMap(({ itemId, modifier }) => {
			const item = timelineStore.itemById.get(itemId);
			return item
				? [{ id: itemId, patch: { motionModifiers: withModifier(item.motionModifiers, modifier) } }]
				: [];
		});
		if (updates.length > 0) timelineStore._updateItems(updates);
		return updates.length;
	});
}

export function removeMotionModifierFromItems(itemIds: string[], type: MotionModifierType): number {
	if (itemIds.length === 0) return 0;
	return execute('REMOVE_MOTION_MODIFIERS', () => {
		const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
		for (const itemId of new Set(itemIds)) {
			const item = timelineStore.itemById.get(itemId);
			if (!item?.motionModifiers?.some((entry) => entry.type === type)) continue;
			const remaining = item.motionModifiers.filter((entry) => entry.type !== type);
			updates.push({
				id: itemId,
				patch: { motionModifiers: remaining.length > 0 ? remaining : undefined }
			});
		}
		if (updates.length > 0) timelineStore._updateItems(updates);
		return updates.length;
	});
}

export function updateMotionModifiersLive(assignments: MotionModifierAssignment[]): void {
	const updates = assignments.flatMap(({ itemId, modifier }) => {
		const item = timelineStore.itemById.get(itemId);
		return item
			? [{ id: itemId, patch: { motionModifiers: withModifier(item.motionModifiers, modifier) } }]
			: [];
	});
	if (updates.length > 0) timelineStore._updateItems(updates);
}

export function beginMotionModifierEdit(): TimelineSnapshot {
	return captureSnapshot();
}

export function commitMotionModifierEdit(
	before: TimelineSnapshot,
	type: MotionModifierType,
	itemIds: string[]
): void {
	commandHistory.addUndoEntry(
		{ type: 'UPDATE_MOTION_MODIFIERS', payload: { type, ids: itemIds } },
		before
	);
}

export interface BakeMotionOptions {
	itemIds: string[];
	fps: number;
	frameWidth: number;
	frameHeight: number;
}

export type BakeMotionResult =
	| { ok: true; bakedItems: number; writtenKeyframes: number }
	| { ok: false; reason: 'empty-selection' | 'no-live-motion' | 'transition-blocked' };

interface BakedMotionMutation {
	patch: Partial<TimelineItem>;
	writtenKeyframes: number;
}

/**
 * Replace live motion with sampled keyframes in one all-or-nothing command.
 * Every sampled frame is checked before any existing lane or modifier changes.
 */
export function bakeMotionToKeyframes(options: BakeMotionOptions): BakeMotionResult {
	const items = uniqueItems(options.itemIds);
	if (items.length === 0) return { ok: false, reason: 'empty-selection' };
	const plan = buildBakeMotionPlan(items, options);
	if (plan.length === 0) return { ok: false, reason: 'no-live-motion' };
	if (plan.some((entry) => entryHasBlockedFrame(entry))) {
		return { ok: false, reason: 'transition-blocked' };
	}

	let writtenKeyframes = 0;
	execute(
		'BAKE_MOTION_TO_KEYFRAMES',
		() => {
			const updates = plan.flatMap((entry) => {
				const item = timelineStore.itemById.get(entry.itemId);
				if (!item) return [];
				const mutation = bakedMotionPatch(item, entry);
				writtenKeyframes += mutation.writtenKeyframes;
				return [{ id: item.id, patch: mutation.patch }];
			});
			if (updates.length > 0) {
				timelineStore._updateItems(updates);
				keyframeSelectionStore.clear();
			}
		},
		{ count: plan.length }
	);
	return { ok: true, bakedItems: plan.length, writtenKeyframes };
}

function uniqueItems(itemIds: readonly string[]): TimelineItem[] {
	const items: TimelineItem[] = [];
	for (const itemId of new Set(itemIds)) {
		const item = timelineStore.itemById.get(itemId);
		if (item) items.push(item);
	}
	return items;
}

function entryHasBlockedFrame(entry: BakeMotionPlanEntry): boolean {
	const item = timelineStore.itemById.get(entry.itemId);
	return (
		!item ||
		entry.keyframes.some(
			(keyframe) =>
				keyframe.frame < 0 ||
				keyframe.frame >= item.durationInFrames ||
				isFrameInTransitionRegion(keyframe.frame, item, transitionsStore.list)
		)
	);
}

function bakedMotionPatch(item: TimelineItem, entry: BakeMotionPlanEntry): BakedMotionMutation {
	const keyframes: ItemKeyframes = { ...item.keyframes };
	for (const property of entry.clearProperties) delete keyframes[property];

	const hasPosition = entry.clearProperties.some(
		(property) => property === 'x' || property === 'y'
	);
	let writtenKeyframes = 0;
	for (const property of entry.clearProperties) {
		if (property === 'x' || property === 'y') continue;
		const propertyKeys = entry.keyframes.filter((keyframe) => keyframe.property === property);
		if (propertyKeys.length === 0) continue;
		keyframes[property] = bakedTrack(propertyKeys);
		writtenKeyframes += propertyKeys.length;
	}

	const position = hasPosition ? bakedPosition(entry.keyframes) : null;
	if (position) writtenKeyframes += position.length;
	const vectorKeyframes = position ? { ...item.vectorKeyframes, position } : item.vectorKeyframes;
	return {
		patch: {
			keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined,
			vectorKeyframes,
			...(position && {
				animationVersion: 2,
				separatedVectorProperties: item.separatedVectorProperties?.filter(
					(property) => property !== 'position'
				)
			}),
			motionModifiers: undefined,
			motionLayers: undefined
		},
		writtenKeyframes
	};
}

function bakedTrack(keyframes: readonly BakedMotionKeyframe[]): KeyframeTrack {
	const sorted = [...keyframes].toSorted((left, right) => left.frame - right.frame);
	return {
		frames: sorted.map((keyframe) => keyframe.frame),
		values: sorted.map((keyframe) => keyframe.value),
		ids: sorted.map(() => crypto.randomUUID()),
		easings: sorted.map(() => 'linear'),
		easingConfigs: sorted.map(() => null)
	};
}

function bakedPosition(keyframes: readonly BakedMotionKeyframe[]): VectorKeyframe[] | null {
	const xByFrame = valuesByFrame(keyframes, 'x');
	const yByFrame = valuesByFrame(keyframes, 'y');
	const frames = [...new Set([...xByFrame.keys(), ...yByFrame.keys()])].toSorted(
		(left, right) => left - right
	);
	if (frames.length === 0) return null;
	return frames.flatMap((frame) => {
		const x = xByFrame.get(frame);
		const y = yByFrame.get(frame);
		return x === undefined || y === undefined
			? []
			: [{ id: crypto.randomUUID(), frame, value: { x, y }, easing: 'linear' }];
	});
}

function valuesByFrame(
	keyframes: readonly BakedMotionKeyframe[],
	property: KeyframeProperty
): Map<number, number> {
	return new Map(
		keyframes
			.filter((keyframe) => keyframe.property === property)
			.map((keyframe) => [keyframe.frame, keyframe.value])
	);
}
