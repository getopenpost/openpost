import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { findNearestSnapTarget, type SnapTarget } from './snapping';
import { isTrackEffectivelyLocked } from './utils/track-groups';

export type TrackPushBlockReason = 'missing-anchor' | 'anchor-locked' | 'downstream-locked';

export interface TrackPushGesturePlan {
	anchorId: string;
	cutFrame: number;
	maxLeftFrames: number;
	shiftedItems: Array<{ id: string; from: number }>;
	breakingTransitionIds: string[];
	blockedBy: TrackPushBlockReason | null;
	lockedItemIds: string[];
}

export interface ResolvedTrackPush {
	delta: number;
	moves: Array<{ id: string; from: number }>;
	snapTarget: SnapTarget | null;
}

/**
 * Measure the empty interval directly before an item on its own track.
 * A clip that begins inside another clip has no usable push handle.
 */
export function trackPushGapBefore(anchor: TimelineItem, items: readonly TimelineItem[]): number {
	let previousEnd = 0;
	for (const item of items) {
		if (item.id === anchor.id || item.trackId !== anchor.trackId || item.from >= anchor.from)
			continue;
		previousEnd = Math.max(previousEnd, item.from + item.durationInFrames);
	}
	return Math.max(0, anchor.from - previousEnd);
}

/**
 * Capture the stable participants and left clamp for one track push gesture.
 * Every item whose start is at or after the cut moves, including items on
 * hidden tracks. Any effective lock blocks the full edit so timing stays in
 * sync across tracks.
 */
export function createTrackPushGesturePlan(args: {
	anchorId: string;
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions: readonly TimelineTransition[];
}): TrackPushGesturePlan {
	const anchor = args.items.find((item) => item.id === args.anchorId);
	if (!anchor) {
		return {
			anchorId: args.anchorId,
			cutFrame: 0,
			maxLeftFrames: 0,
			shiftedItems: [],
			breakingTransitionIds: [],
			blockedBy: 'missing-anchor',
			lockedItemIds: []
		};
	}

	const shiftedSourceItems = args.items.filter((item) => item.from >= anchor.from);
	const shiftedItems = shiftedSourceItems.map((item) => ({ id: item.id, from: item.from }));
	const shiftedIds = new Set(shiftedItems.map((item) => item.id));
	const lockedItemIds = shiftedSourceItems
		.filter((item) => isTrackEffectivelyLocked(item.trackId, args.tracks))
		.map((item) => item.id);

	let maxLeftFrames = Number.POSITIVE_INFINITY;
	const trackIds = new Set(args.items.map((item) => item.trackId));
	for (const trackId of trackIds) {
		let firstShiftedFrom = Number.POSITIVE_INFINITY;
		let lastStaticEnd = 0;
		for (const item of args.items) {
			if (item.trackId !== trackId) continue;
			if (shiftedIds.has(item.id)) firstShiftedFrom = Math.min(firstShiftedFrom, item.from);
			else if (item.from < anchor.from) {
				lastStaticEnd = Math.max(lastStaticEnd, item.from + item.durationInFrames);
			}
		}
		if (Number.isFinite(firstShiftedFrom)) {
			maxLeftFrames = Math.min(maxLeftFrames, Math.max(0, firstShiftedFrom - lastStaticEnd));
		}
	}
	if (!Number.isFinite(maxLeftFrames)) maxLeftFrames = anchor.from;

	const breakingTransitionIds = args.transitions
		.filter(
			(transition) => shiftedIds.has(transition.fromItemId) !== shiftedIds.has(transition.toItemId)
		)
		.map((transition) => transition.id);

	return {
		anchorId: anchor.id,
		cutFrame: anchor.from,
		maxLeftFrames,
		shiftedItems,
		breakingTransitionIds,
		blockedBy: isTrackEffectivelyLocked(anchor.trackId, args.tracks)
			? 'anchor-locked'
			: lockedItemIds.length > 0
				? 'downstream-locked'
				: null,
		lockedItemIds
	};
}

/** Resolve one pointer or keyboard delta against the captured gesture plan. */
export function resolveTrackPush(
	plan: TrackPushGesturePlan,
	requestedDelta: number,
	snapTargets: readonly SnapTarget[] = [],
	snapThresholdFrames = 0
): ResolvedTrackPush {
	if (plan.blockedBy || plan.shiftedItems.length === 0) {
		return { delta: 0, moves: [], snapTarget: null };
	}

	let delta = Math.max(-plan.maxLeftFrames, Math.round(requestedDelta));
	let snapTarget: SnapTarget | null = null;
	if (snapThresholdFrames > 0) {
		const target = findNearestSnapTarget(
			plan.cutFrame + delta,
			[...snapTargets],
			snapThresholdFrames
		);
		if (target) {
			const snappedDelta = target.frame - plan.cutFrame;
			const clampedDelta = Math.max(-plan.maxLeftFrames, snappedDelta);
			delta = clampedDelta;
			snapTarget = clampedDelta === snappedDelta ? target : null;
		}
	}

	return {
		delta,
		moves: plan.shiftedItems.map((item) => ({
			id: item.id,
			from: item.from + delta
		})),
		snapTarget
	};
}
