/**
 * Shared edit guards for transition and keyframe state.
 *
 * Ported from FreeCut (MIT) - timeline/utils/trim-edit-constraints.ts,
 * timeline/utils/slide-keyframe-constraints.ts, and keyframes-store.ts.
 */

import type {
	ItemKeyframes,
	EasingType,
	KeyframeProperty,
	KeyframeTrack,
	TimelineItem,
	TimelineTransition
} from '../project/types';
import { calculateTransitionPortions, canPreserveTransition } from './transition-planner';

export interface TimelineEditUpdate {
	id: string;
	patch: Partial<TimelineItem>;
}

function applyUpdate(item: TimelineItem, update: TimelineEditUpdate | undefined): TimelineItem {
	return update ? { ...item, ...update.patch } : item;
}

function transitionIsStructurallyValid(
	transition: TimelineTransition,
	itemsById: ReadonlyMap<string, TimelineItem>,
	maxCutGap = 1
): boolean {
	const left = itemsById.get(transition.fromItemId);
	const right = itemsById.get(transition.toItemId);
	if (!left || !right || left.trackId !== right.trackId) return false;
	const cutGap = Math.abs(left.from + left.durationInFrames - right.from);
	return (
		cutGap <= maxCutGap &&
		transition.durationInFrames > 0 &&
		transition.durationInFrames < Math.min(left.durationInFrames, right.durationInFrames)
	);
}

export function isFrameInTransitionRegion(
	frame: number,
	item: TimelineItem,
	transitions: TimelineTransition[]
): boolean {
	for (const transition of transitions) {
		const { leftPortion, rightPortion } = calculateTransitionPortions(
			transition.durationInFrames,
			transition.alignment
		);
		if (transition.fromItemId === item.id && frame >= item.durationInFrames - leftPortion)
			return true;
		if (transition.toItemId === item.id && frame < rightPortion) return true;
	}
	return false;
}

function collectPreservedKeyframes(
	item: TimelineItem,
	transitions: TimelineTransition[]
): number[] {
	const frames = new Set<number>();
	for (const track of Object.values(item.keyframes ?? {})) {
		if (!track) continue;
		for (const frame of track.frames) {
			if (
				frame >= 0 &&
				frame < item.durationInFrames &&
				!isFrameInTransitionRegion(frame, item, transitions)
			)
				frames.add(frame);
		}
	}
	for (const track of Object.values(item.vectorKeyframes ?? {})) {
		for (const keyframe of track ?? []) {
			if (
				keyframe.frame >= 0 &&
				keyframe.frame < item.durationInFrames &&
				!isFrameInTransitionRegion(keyframe.frame, item, transitions)
			) {
				frames.add(keyframe.frame);
			}
		}
	}
	return [...frames];
}

/** Binary-search the largest requested edit that keeps transitions and keys valid. */
export function clampEditDeltaToPreserveState({
	requestedDelta,
	items,
	transitions,
	affectedIds,
	buildUpdates,
	preserveKeyframes = true,
	timelineFps = 30
}: {
	requestedDelta: number;
	items: TimelineItem[];
	transitions: TimelineTransition[];
	affectedIds: ReadonlySet<string>;
	buildUpdates: (delta: number) => TimelineEditUpdate[];
	preserveKeyframes?: boolean;
	timelineFps?: number;
}): number {
	if (requestedDelta === 0) return 0;
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const relatedTransitions = transitions.filter((transition) => {
		if (!affectedIds.has(transition.fromItemId) && !affectedIds.has(transition.toItemId))
			return false;
		if (!transitionIsStructurallyValid(transition, itemsById)) return false;
		const left = itemsById.get(transition.fromItemId);
		const right = itemsById.get(transition.toItemId);
		return left && right ? canPreserveTransition(transition, left, right, timelineFps) : false;
	});
	const baselineCutGap = new Map(
		relatedTransitions.map((transition) => {
			const left = itemsById.get(transition.fromItemId);
			const right = itemsById.get(transition.toItemId);
			return [
				transition.id,
				left && right ? Math.abs(left.from + left.durationInFrames - right.from) : 1
			] as const;
		})
	);
	const preservedFrames = new Map<string, number[]>();
	if (preserveKeyframes) {
		for (const itemId of affectedIds) {
			const item = itemsById.get(itemId);
			if (!item) continue;
			const frames = collectPreservedKeyframes(item, transitions);
			if (frames.length > 0) preservedFrames.set(itemId, frames);
		}
	}

	const isValid = (delta: number): boolean => {
		const updates = buildUpdates(delta);
		const updatesById = new Map(updates.map((update) => [update.id, update]));
		const previewById = new Map(
			items.map((item) => [item.id, applyUpdate(item, updatesById.get(item.id))])
		);

		for (const transition of relatedTransitions) {
			const left = previewById.get(transition.fromItemId);
			const right = previewById.get(transition.toItemId);
			if (
				!left ||
				!right ||
				!canPreserveTransition(
					transition,
					left,
					right,
					timelineFps,
					baselineCutGap.get(transition.id) ?? 1
				)
			)
				return false;
		}
		for (const [itemId, frames] of preservedFrames) {
			const preview = previewById.get(itemId);
			if (!preview) continue;
			for (const frame of frames) {
				if (
					frame >= preview.durationInFrames ||
					isFrameInTransitionRegion(frame, preview, transitions)
				)
					return false;
			}
		}
		return true;
	};

	if (!isValid(0)) return 0;
	if (isValid(requestedDelta)) return requestedDelta;
	const sign = requestedDelta < 0 ? -1 : 1;
	let low = 0;
	let high = Math.abs(requestedDelta);
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (isValid(sign * middle)) low = middle;
		else high = middle - 1;
	}
	return low === 0 ? 0 : sign * low;
}

function scaleTrack(track: KeyframeTrack, scale: number, maxFrame: number): KeyframeTrack {
	const byFrame = new Map<
		number,
		{
			originalFrame: number;
			value: number;
			id?: string;
			easing?: EasingType;
			easingConfig?: NonNullable<KeyframeTrack['easingConfigs']>[number];
			source?: NonNullable<KeyframeTrack['sources']>[number];
		}
	>();
	for (let index = 0; index < track.frames.length; index += 1) {
		const originalFrame = track.frames[index] ?? 0;
		const frame = Math.min(maxFrame, Math.max(0, Math.round(originalFrame * scale)));
		const existing = byFrame.get(frame);
		if (existing && existing.originalFrame > originalFrame) continue;
		byFrame.set(frame, {
			originalFrame,
			value: track.values[index] ?? 0,
			id: track.ids?.[index],
			easing: track.easings?.[index],
			easingConfig: track.easingConfigs?.[index],
			source: track.sources?.[index]
		});
	}
	const entries = [...byFrame.entries()].sort(([left], [right]) => left - right);
	const scaled: KeyframeTrack = {
		frames: entries.map(([frame]) => frame),
		values: entries.map(([, entry]) => entry.value)
	};
	if (track.ids) scaled.ids = entries.map(([, entry]) => entry.id ?? crypto.randomUUID());
	if (track.easings) scaled.easings = entries.map(([, entry]) => entry.easing ?? 'linear');
	if (track.easingConfigs)
		scaled.easingConfigs = entries.map(([, entry]) => entry.easingConfig ?? null);
	if (track.sources) scaled.sources = entries.map(([, entry]) => entry.source ?? null);
	return scaled;
}

/** Scale local keyframe timing with a rate-stretched clip. */
export function scaleItemKeyframes(
	keyframes: ItemKeyframes | undefined,
	oldDuration: number,
	newDuration: number
): ItemKeyframes | undefined {
	if (!keyframes || oldDuration <= 0 || newDuration <= 0 || oldDuration === newDuration)
		return keyframes;
	const scale = newDuration / oldDuration;
	const maxFrame = newDuration - 1;
	const scaled: ItemKeyframes = {};
	for (const [property, track] of Object.entries(keyframes)) {
		if (!track) continue;
		// SAFETY: Object.entries can only return keys declared by ItemKeyframes.
		const keyframeProperty = property as KeyframeProperty;
		scaled[keyframeProperty] = scaleTrack(track, scale, maxFrame);
	}
	return scaled;
}
