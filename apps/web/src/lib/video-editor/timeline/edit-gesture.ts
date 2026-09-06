/** Pure edit plans for live timeline pointer and keyboard gestures. */

import type { TimelineItem, TimelineTransition } from '../project/types';
import {
	calculateTrimSourceUpdate,
	clampToAdjacentItems,
	clampTrimAmount,
	type TrimHandle
} from './utils/trim-utils';
import {
	getClampedRateStretchSpeed,
	getRateStretchDurationLimits,
	getSourceProperties,
	resolveRateStretchDurationAndSpeed,
	timelineToSourceFrames
} from './utils/source-calculations';
import { calculateEdgeSnap, calculateMoveSnap, type SnapTarget } from './snapping';
import {
	clampEditDeltaToPreserveState,
	scaleItemKeyframes,
	type TimelineEditUpdate
} from './edit-constraints';
import { scaleItemVectorKeyframes } from './vector-keyframes';
import {
	getLinkedItems,
	getSynchronizedLinkedCounterpartPair,
	getSynchronizedLinkedItems
} from './utils/linked-items';
import { clampMoveDeltaToTrackGaps } from './track-occupancy';
import { shiftSpeedRampSourceFrames } from './source-time-map';

export interface TrimGesturePlan {
	patch: Partial<TimelineItem>;
	snapTarget: SnapTarget | null;
	linkedPatches?: TimelineEditUpdate[];
}

export interface RollingTrimGesturePlan {
	leftPatch: Partial<TimelineItem>;
	rightPatch: Partial<TimelineItem>;
	snapTarget: SnapTarget | null;
	linkedPatches?: TimelineEditUpdate[];
}

export interface SlideGesturePlan {
	itemPatch: Partial<TimelineItem>;
	leftPatch: Partial<TimelineItem> | null;
	rightPatch: Partial<TimelineItem> | null;
	snapTarget: SnapTarget | null;
	linkedPatches?: TimelineEditUpdate[];
}

export interface RateStretchGesturePlan {
	patch: Partial<TimelineItem>;
	moves: Array<{ id: string; from: number }>;
	snapTarget: SnapTarget | null;
	linkedPatches?: TimelineEditUpdate[];
}

export interface RippleTrimGesturePlan {
	patch: Partial<TimelineItem>;
	moves: Array<{ id: string; from: number }>;
	snapTarget: SnapTarget | null;
	linkedPatches?: TimelineEditUpdate[];
}

export interface TimelineMove {
	id: string;
	from: number;
}

type LinkedPatchPlan =
	| TrimGesturePlan
	| RollingTrimGesturePlan
	| SlideGesturePlan
	| RateStretchGesturePlan
	| RippleTrimGesturePlan;

function withAnchor(item: TimelineItem, allItems: TimelineItem[]): TimelineItem[] {
	const byId = new Map(allItems.map((candidate) => [candidate.id, candidate]));
	byId.set(item.id, item);
	return [...byId.values()];
}

function synchronizedParticipants(item: TimelineItem, allItems: TimelineItem[]): TimelineItem[] {
	return getSynchronizedLinkedItems(withAnchor(item, allItems), item.id);
}

/** Move every still-synchronized linked clip by one common timeline delta. */
export function planLinkedMoveGesture(
	item: TimelineItem,
	proposedFrom: number,
	allItems: TimelineItem[],
	selectedItemIds: string[] = [item.id]
): TimelineMove[] {
	const items = withAnchor(item, allItems);
	const participantById = new Map<string, TimelineItem>();
	const anchors = selectedItemIds.includes(item.id) ? selectedItemIds : [item.id];
	for (const anchorId of anchors) {
		for (const participant of getSynchronizedLinkedItems(items, anchorId)) {
			participantById.set(participant.id, participant);
		}
	}
	participantById.set(item.id, item);
	const participants = [...participantById.values()];
	let delta = proposedFrom - item.from;
	delta = clampMoveDeltaToTrackGaps(items, new Set(participantById.keys()), delta);
	return participants.map((participant) => ({
		id: participant.id,
		from: participant.from + delta
	}));
}

function appendLinkedPatches<T extends LinkedPatchPlan>(plan: T, updates: TimelineEditUpdate[]): T {
	if (updates.length > 0) plan.linkedPatches = updates;
	return plan;
}

function tighterDelta(current: number, candidate: number): number {
	if (current > 0) return Math.max(0, Math.min(current, candidate));
	if (current < 0) return Math.min(0, Math.max(current, candidate));
	return 0;
}

function trimPatchForAmount(
	item: TimelineItem,
	handle: TrimHandle,
	amount: number,
	timelineFps: number
): Partial<TimelineItem> {
	const durationInFrames =
		handle === 'start' ? item.durationInFrames - amount : item.durationInFrames + amount;
	const patch: Partial<TimelineItem> =
		handle === 'start' ? { from: item.from + amount, durationInFrames } : { durationInFrames };
	const sourceUpdate = calculateTrimSourceUpdate(
		item,
		handle,
		amount,
		durationInFrames,
		timelineFps
	);
	if (sourceUpdate) Object.assign(patch, sourceUpdate);
	return patch;
}

export function planTrimGesture(
	item: TimelineItem,
	handle: TrimHandle,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number,
	transitions: TimelineTransition[] = []
): TrimGesturePlan {
	const items = withAnchor(item, allItems);
	const participants = synchronizedParticipants(item, items);
	const participantIds = new Set(participants.map((participant) => participant.id));
	const originalEdge = handle === 'start' ? item.from : item.from + item.durationInFrames;
	const snap = calculateEdgeSnap(
		originalEdge + deltaTimelineFrames,
		snapTargets,
		snapThresholdFrames
	);
	let amount = snap.snappedFrame - originalEdge;
	for (const participant of participants) {
		amount = tighterDelta(
			amount,
			clampTrimAmount(participant, handle, amount, timelineFps).clampedAmount
		);
		amount = tighterDelta(
			amount,
			clampToAdjacentItems(participant, handle, amount, items, participantIds)
		);
	}
	amount = clampEditDeltaToPreserveState({
		requestedDelta: amount,
		items,
		transitions,
		affectedIds: participantIds,
		buildUpdates: (delta) =>
			participants.map((participant) => ({
				id: participant.id,
				patch: trimPatchForAmount(participant, handle, delta, timelineFps)
			})),
		timelineFps
	});
	const finalEdge = originalEdge + amount;
	const snapTarget = snap.snapTarget?.frame === finalEdge ? snap.snapTarget : null;
	return appendLinkedPatches(
		{
			patch: trimPatchForAmount(item, handle, amount, timelineFps),
			snapTarget
		},
		participants
			.filter((participant) => participant.id !== item.id)
			.map((participant) => ({
				id: participant.id,
				patch: trimPatchForAmount(participant, handle, amount, timelineFps)
			}))
	);
}

export function planRollingTrimGesture(
	left: TimelineItem,
	right: TimelineItem,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number,
	transitions: TimelineTransition[] = []
): RollingTrimGesturePlan | null {
	const editPoint = left.from + left.durationInFrames;
	if (left.trackId !== right.trackId || right.from !== editPoint) return null;
	const items = withAnchor(right, withAnchor(left, allItems));
	const counterpartPair = getSynchronizedLinkedCounterpartPair(items, left.id, right.id);
	const pairs = [
		{ left, right },
		...(counterpartPair
			? [
					{
						left: counterpartPair.leftCounterpart,
						right: counterpartPair.rightCounterpart
					}
				]
			: [])
	];
	const affectedIds = new Set(pairs.flatMap((pair) => [pair.left.id, pair.right.id]));
	const snap = calculateEdgeSnap(editPoint + deltaTimelineFrames, snapTargets, snapThresholdFrames);
	let amount = snap.snappedFrame - editPoint;
	for (const pair of pairs) {
		amount = tighterDelta(
			amount,
			clampTrimAmount(pair.left, 'end', amount, timelineFps).clampedAmount
		);
		amount = tighterDelta(
			amount,
			clampTrimAmount(pair.right, 'start', amount, timelineFps).clampedAmount
		);
		amount = tighterDelta(
			amount,
			clampToAdjacentItems(pair.left, 'end', amount, items, affectedIds)
		);
		amount = tighterDelta(
			amount,
			clampToAdjacentItems(pair.right, 'start', amount, items, affectedIds)
		);
	}
	amount = clampEditDeltaToPreserveState({
		requestedDelta: amount,
		items,
		transitions,
		affectedIds,
		buildUpdates: (delta) =>
			pairs.flatMap((pair) => [
				{
					id: pair.left.id,
					patch: trimPatchForAmount(pair.left, 'end', delta, timelineFps)
				},
				{
					id: pair.right.id,
					patch: trimPatchForAmount(pair.right, 'start', delta, timelineFps)
				}
			]),
		timelineFps
	});
	const finalEditPoint = editPoint + amount;
	return appendLinkedPatches(
		{
			leftPatch: trimPatchForAmount(left, 'end', amount, timelineFps),
			rightPatch: trimPatchForAmount(right, 'start', amount, timelineFps),
			snapTarget: snap.snapTarget?.frame === finalEditPoint ? snap.snapTarget : null
		},
		counterpartPair
			? [
					{
						id: counterpartPair.leftCounterpart.id,
						patch: trimPatchForAmount(counterpartPair.leftCounterpart, 'end', amount, timelineFps)
					},
					{
						id: counterpartPair.rightCounterpart.id,
						patch: trimPatchForAmount(
							counterpartPair.rightCounterpart,
							'start',
							amount,
							timelineFps
						)
					}
				]
			: []
	);
}

export function planSlipGesture(
	item: TimelineItem,
	deltaTimelineFrames: number,
	timelineFps: number
): Pick<TimelineItem, 'sourceStart' | 'sourceEnd' | 'speedRamp'> | null {
	if (item.type !== 'video' && item.type !== 'audio') return null;
	const { sourceStart, sourceEnd, sourceDuration, sourceFps, speed } = getSourceProperties(item);
	if (sourceEnd === undefined) return null;
	const effectiveSourceFps = sourceFps ?? timelineFps;
	const windowFrames = Math.max(1, sourceEnd - sourceStart);
	const requestedDelta = timelineToSourceFrames(
		-deltaTimelineFrames,
		speed,
		timelineFps,
		effectiveSourceFps
	);
	const maxStart =
		sourceDuration === undefined
			? Number.POSITIVE_INFINITY
			: Math.max(0, sourceDuration - windowFrames);
	const nextStart = Math.min(Math.max(sourceStart + requestedDelta, 0), maxStart);
	const sourceDelta = nextStart - sourceStart;
	const patch: Pick<TimelineItem, 'sourceStart' | 'sourceEnd' | 'speedRamp'> = {
		sourceStart: nextStart,
		sourceEnd: nextStart + windowFrames
	};
	if (item.speedRamp?.length) {
		patch.speedRamp = shiftSpeedRampSourceFrames(item.speedRamp, sourceDelta);
	}
	return patch;
}

/** Plan one source-space slip across every still-synchronized linked clip. */
export function planLinkedSlipGesture(
	item: TimelineItem,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	transitions: TimelineTransition[] = []
): TimelineEditUpdate[] {
	const anchorPatch = planSlipGesture(item, deltaTimelineFrames, timelineFps);
	if (!anchorPatch) return [];
	const anchorSourceStart = anchorPatch.sourceStart;
	if (anchorSourceStart === undefined) return [];
	const participants = synchronizedParticipants(item, allItems);
	let sourceDelta = anchorSourceStart - (item.sourceStart ?? 0);
	for (const participant of participants) {
		if (participant.sourceEnd === undefined) continue;
		const start = participant.sourceStart ?? 0;
		const sourceWindow = participant.sourceEnd - start;
		const minimum = -start;
		const maximum =
			participant.sourceDuration === undefined
				? Number.POSITIVE_INFINITY
				: participant.sourceDuration - sourceWindow - start;
		sourceDelta = Math.min(Math.max(sourceDelta, minimum), maximum);
	}
	const buildUpdates = (delta: number): TimelineEditUpdate[] =>
		participants.flatMap((participant) => {
			if (participant.sourceEnd === undefined) return [];
			const sourceStart = (participant.sourceStart ?? 0) + delta;
			const patch: Partial<TimelineItem> = {
				sourceStart,
				sourceEnd: participant.sourceEnd + delta
			};
			if (participant.speedRamp?.length) {
				patch.speedRamp = shiftSpeedRampSourceFrames(participant.speedRamp, delta);
			}
			return [
				{
					id: participant.id,
					patch
				}
			];
		});
	sourceDelta = clampEditDeltaToPreserveState({
		requestedDelta: sourceDelta,
		items: withAnchor(item, allItems),
		transitions,
		affectedIds: new Set(participants.map((participant) => participant.id)),
		buildUpdates,
		timelineFps
	});
	return buildUpdates(sourceDelta);
}

function canJoinForSlide(left: TimelineItem, right: TimelineItem): boolean {
	if (!left.originId || left.originId !== right.originId) return false;
	if (left.trackId !== right.trackId || !left.mediaId || left.mediaId !== right.mediaId)
		return false;
	if (left.from + left.durationInFrames !== right.from) return false;
	if ((left.speed ?? 1) !== (right.speed ?? 1)) return false;
	const leftSourceEnd = left.sourceEnd;
	const rightSourceStart = right.sourceStart ?? 0;
	return leftSourceEnd !== undefined && Math.abs(leftSourceEnd - rightSourceStart) <= 0.5;
}

function slideContinuityPatch(
	item: TimelineItem,
	left: TimelineItem | null,
	right: TimelineItem | null,
	deltaTimelineFrames: number,
	timelineFps: number
): Partial<TimelineItem> {
	if (
		!left ||
		!right ||
		!canJoinForSlide(left, item) ||
		!canJoinForSlide(item, right) ||
		item.sourceEnd === undefined
	) {
		return {};
	}
	const sourceStart = item.sourceStart ?? 0;
	const sourceEnd = item.sourceEnd;
	const sourceWindow = sourceEnd - sourceStart;
	const sourceDelta = timelineToSourceFrames(
		deltaTimelineFrames,
		item.speed ?? 1,
		timelineFps,
		item.sourceFps ?? timelineFps
	);
	const maxStart =
		item.sourceDuration === undefined
			? Number.POSITIVE_INFINITY
			: Math.max(0, item.sourceDuration - sourceWindow);
	const nextStart = Math.min(Math.max(sourceStart + sourceDelta, 0), maxStart);
	return { sourceStart: nextStart, sourceEnd: nextStart + sourceWindow };
}

export function planSlideGesture(
	item: TimelineItem,
	left: TimelineItem | null,
	right: TimelineItem | null,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number,
	transitions: TimelineTransition[] = []
): SlideGesturePlan {
	const items = withAnchor(item, allItems);
	const participants = synchronizedParticipants(item, items).map((participant) => {
		if (participant.id === item.id) return { item: participant, left, right };
		const participantEnd = participant.from + participant.durationInFrames;
		return {
			item: participant,
			left:
				items.find(
					(candidate) =>
						candidate.id !== participant.id &&
						candidate.trackId === participant.trackId &&
						candidate.from + candidate.durationInFrames === participant.from
				) ?? null,
			right:
				items.find(
					(candidate) =>
						candidate.id !== participant.id &&
						candidate.trackId === participant.trackId &&
						candidate.from === participantEnd
				) ?? null
		};
	});
	const affectedIds = new Set(
		participants.flatMap((participant) => [
			participant.item.id,
			...(participant.left ? [participant.left.id] : []),
			...(participant.right ? [participant.right.id] : [])
		])
	);
	const snap = calculateMoveSnap(
		item.from + deltaTimelineFrames,
		item.durationInFrames,
		snapTargets,
		snapThresholdFrames
	);
	let amount = snap.snappedFrame - item.from;
	for (const participant of participants) {
		amount = tighterDelta(amount, Math.max(-participant.item.from, amount));
		if (participant.left) {
			amount = tighterDelta(
				amount,
				clampTrimAmount(participant.left, 'end', amount, timelineFps).clampedAmount
			);
			amount = tighterDelta(
				amount,
				clampToAdjacentItems(participant.left, 'end', amount, items, affectedIds)
			);
		}
		if (participant.right) {
			amount = tighterDelta(
				amount,
				clampTrimAmount(participant.right, 'start', amount, timelineFps).clampedAmount
			);
			amount = tighterDelta(
				amount,
				clampToAdjacentItems(participant.right, 'start', amount, items, affectedIds)
			);
		}
	}
	const buildUpdates = (delta: number): TimelineEditUpdate[] =>
		participants.flatMap((participant) => [
			{
				id: participant.item.id,
				patch: {
					from: participant.item.from + delta,
					...slideContinuityPatch(
						participant.item,
						participant.left,
						participant.right,
						delta,
						timelineFps
					)
				}
			},
			...(participant.left
				? [
						{
							id: participant.left.id,
							patch: trimPatchForAmount(participant.left, 'end', delta, timelineFps)
						}
					]
				: []),
			...(participant.right
				? [
						{
							id: participant.right.id,
							patch: trimPatchForAmount(participant.right, 'start', delta, timelineFps)
						}
					]
				: [])
		]);
	amount = clampEditDeltaToPreserveState({
		requestedDelta: amount,
		items,
		transitions,
		affectedIds,
		buildUpdates,
		timelineFps
	});
	const finalFrom = item.from + amount;
	const updates = buildUpdates(amount);
	return appendLinkedPatches(
		{
			itemPatch: {
				from: finalFrom,
				...slideContinuityPatch(item, left, right, amount, timelineFps)
			},
			leftPatch: left ? trimPatchForAmount(left, 'end', amount, timelineFps) : null,
			rightPatch: right ? trimPatchForAmount(right, 'start', amount, timelineFps) : null,
			snapTarget: snap.snappedFrame === finalFrom ? snap.snapTarget : null
		},
		updates.filter(
			(update) => update.id !== item.id && update.id !== left?.id && update.id !== right?.id
		)
	);
}

export function planRateStretchGesture(
	item: TimelineItem,
	handle: TrimHandle,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number,
	transitions: TimelineTransition[] = []
): RateStretchGesturePlan | null {
	if (item.type !== 'video' && item.type !== 'audio') return null;
	const sourceStart = item.sourceStart ?? 0;
	const sourceFrames =
		item.sourceEnd !== undefined
			? item.sourceEnd - sourceStart
			: (item.sourceDuration ?? sourceStart) - sourceStart;
	if (sourceFrames <= 0) return null;
	const sourceFps = item.sourceFps ?? timelineFps;
	const originalFrom = item.from;
	const originalEnd = item.from + item.durationInFrames;
	const originalEdge = handle === 'start' ? originalFrom : originalEnd;
	const snap = calculateEdgeSnap(
		originalEdge + deltaTimelineFrames,
		snapTargets,
		snapThresholdFrames
	);
	const proposedDuration =
		handle === 'start'
			? item.durationInFrames - (snap.snappedFrame - originalFrom)
			: snap.snappedFrame - originalFrom;
	const { min: minDuration, max: maxDuration } = getRateStretchDurationLimits(
		sourceFrames,
		sourceFps,
		timelineFps
	);
	const startBoundedMaxDuration =
		handle === 'start' ? Math.min(maxDuration, originalEnd) : maxDuration;
	const boundedDuration = resolveRateStretchDurationAndSpeed(
		sourceFrames,
		Math.max(Math.round(proposedDuration), minDuration),
		sourceFps,
		timelineFps
	).duration;
	const finalBoundedDuration = Math.min(boundedDuration, startBoundedMaxDuration);
	const items = withAnchor(item, allItems);
	const participants = synchronizedParticipants(item, items);
	const participantIds = new Set(participants.map((participant) => participant.id));
	const touchedTrackIds = new Set(participants.map((participant) => participant.trackId));
	const buildMoves = (durationDelta: number): Array<{ id: string; from: number }> => {
		const edgeDelta = handle === 'start' ? -durationDelta : durationDelta;
		const movedById = new Map<string, number>();
		const addMove = (candidate: TimelineItem): void => {
			for (const linked of getLinkedItems(items, candidate.id)) {
				if (!participantIds.has(linked.id)) {
					movedById.set(linked.id, linked.from + edgeDelta);
				}
			}
		};
		for (const candidate of items) {
			if (participantIds.has(candidate.id) || !touchedTrackIds.has(candidate.trackId)) continue;
			const candidateEnd = candidate.from + candidate.durationInFrames;
			if (handle === 'end' ? candidate.from >= originalEnd : candidateEnd <= originalFrom) {
				addMove(candidate);
			}
		}
		for (const transition of transitions) {
			const neighborId =
				handle === 'end' && participantIds.has(transition.fromItemId)
					? transition.toItemId
					: handle === 'start' && participantIds.has(transition.toItemId)
						? transition.fromItemId
						: null;
			if (!neighborId || participantIds.has(neighborId)) continue;
			const neighbor = items.find((candidate) => candidate.id === neighborId);
			if (neighbor) addMove(neighbor);
		}
		return [...movedById].map(([id, from]) => ({ id, from }));
	};
	const buildUpdates = (durationDelta: number): TimelineEditUpdate[] => {
		const durationInFrames = item.durationInFrames + durationDelta;
		const fromDelta = handle === 'start' ? -durationDelta : 0;
		const speed = getClampedRateStretchSpeed(
			sourceFrames,
			durationInFrames,
			sourceFps,
			timelineFps
		);
		return [
			...participants.map((participant) => ({
				id: participant.id,
				patch: {
					from: participant.from + fromDelta,
					durationInFrames,
					speed,
					keyframes: scaleItemKeyframes(
						participant.keyframes,
						participant.durationInFrames,
						durationInFrames
					),
					...(participant.vectorKeyframes && {
						vectorKeyframes: scaleItemVectorKeyframes(
							participant.vectorKeyframes,
							participant.durationInFrames,
							durationInFrames
						)
					})
				}
			})),
			...buildMoves(durationDelta).map((move) => ({
				id: move.id,
				patch: { from: move.from }
			}))
		];
	};
	let durationDelta = finalBoundedDuration - item.durationInFrames;
	if (handle === 'start' && durationDelta > 0) {
		const itemsById = new Map(items.map((candidate) => [candidate.id, candidate]));
		const availableUpstreamRoom = buildMoves(durationDelta).reduce(
			(available, move) => Math.min(available, itemsById.get(move.id)?.from ?? available),
			durationDelta
		);
		durationDelta = Math.min(durationDelta, availableUpstreamRoom);
	}
	durationDelta = clampEditDeltaToPreserveState({
		requestedDelta: durationDelta,
		items,
		transitions,
		affectedIds: new Set([...participantIds, ...buildMoves(durationDelta).map((move) => move.id)]),
		buildUpdates,
		preserveKeyframes: false,
		timelineFps
	});
	const durationInFrames = item.durationInFrames + durationDelta;
	const fromDelta = handle === 'start' ? -durationDelta : 0;
	const speed = getClampedRateStretchSpeed(sourceFrames, durationInFrames, sourceFps, timelineFps);
	const moves = buildMoves(durationDelta);
	const finalEdge = handle === 'start' ? item.from + fromDelta : item.from + durationInFrames;
	const anchorPatch: Partial<TimelineItem> = {
		durationInFrames,
		speed,
		keyframes: scaleItemKeyframes(item.keyframes, item.durationInFrames, durationInFrames),
		...(item.vectorKeyframes && {
			vectorKeyframes: scaleItemVectorKeyframes(
				item.vectorKeyframes,
				item.durationInFrames,
				durationInFrames
			)
		})
	};
	if (handle === 'start') anchorPatch.from = item.from + fromDelta;
	return appendLinkedPatches(
		{
			patch: anchorPatch,
			moves,
			snapTarget: finalEdge === snap.snappedFrame ? snap.snapTarget : null
		},
		participants
			.filter((participant) => participant.id !== item.id)
			.map((participant) => {
				const patch: Partial<TimelineItem> = {
					durationInFrames,
					speed,
					keyframes: scaleItemKeyframes(
						participant.keyframes,
						participant.durationInFrames,
						durationInFrames
					),
					...(participant.vectorKeyframes && {
						vectorKeyframes: scaleItemVectorKeyframes(
							participant.vectorKeyframes,
							participant.durationInFrames,
							durationInFrames
						)
					})
				};
				if (handle === 'start') patch.from = participant.from + fromDelta;
				return { id: participant.id, patch };
			})
	);
}

/**
 * Trim one edge and ripple every later item on the synchronized clips' tracks.
 * Start trims keep the clip's timeline start anchored, matching FreeCut's
 * ripple-start model. End trims move the edit point directly.
 */
export function planRippleTrimGesture(
	item: TimelineItem,
	handle: TrimHandle,
	deltaTimelineFrames: number,
	allItems: TimelineItem[],
	timelineFps: number,
	snapTargets: SnapTarget[],
	snapThresholdFrames: number,
	transitions: TimelineTransition[] = []
): RippleTrimGesturePlan {
	const items = withAnchor(item, allItems);
	const participants = synchronizedParticipants(item, items);
	const participantIds = new Set(participants.map((participant) => participant.id));
	const originalEdge = handle === 'start' ? item.from : item.from + item.durationInFrames;
	const snap = calculateEdgeSnap(
		originalEdge + deltaTimelineFrames,
		snapTargets,
		snapThresholdFrames
	);
	let amount = snap.snappedFrame - originalEdge;
	for (const participant of participants) {
		amount = tighterDelta(
			amount,
			clampTrimAmount(participant, handle, amount, timelineFps).clampedAmount
		);
	}

	const buildTrimUpdates = (delta: number): TimelineEditUpdate[] =>
		participants.map((participant) => {
			const patch = trimPatchForAmount(participant, handle, delta, timelineFps);
			if (handle === 'start') patch.from = participant.from;
			return { id: participant.id, patch };
		});
	amount = clampEditDeltaToPreserveState({
		requestedDelta: amount,
		items,
		transitions,
		affectedIds: participantIds,
		buildUpdates: buildTrimUpdates,
		timelineFps
	});

	const shift = handle === 'end' ? amount : -amount;
	const movedById = new Map<string, number>();
	const addMove = (candidate: TimelineItem): void => {
		if (!participantIds.has(candidate.id)) movedById.set(candidate.id, candidate.from + shift);
	};
	if (shift !== 0) {
		for (const participant of participants) {
			const oldEnd = participant.from + participant.durationInFrames;
			const transitionNeighbors = new Set(
				transitions
					.filter((transition) => transition.fromItemId === participant.id)
					.map((transition) => transition.toItemId)
			);
			for (const candidate of items) {
				if (participantIds.has(candidate.id) || candidate.trackId !== participant.trackId) continue;
				if (candidate.from >= oldEnd || transitionNeighbors.has(candidate.id)) addMove(candidate);
			}
		}
	}

	const trimUpdates = buildTrimUpdates(amount);
	const anchorPatch = trimUpdates.find((update) => update.id === item.id)?.patch ?? {};
	const finalDraggedEdge = originalEdge + amount;
	return appendLinkedPatches(
		{
			patch: anchorPatch,
			moves: [...movedById].map(([id, from]) => ({ id, from })),
			snapTarget: finalDraggedEdge === snap.snappedFrame ? snap.snapTarget : null
		},
		trimUpdates.filter((update) => update.id !== item.id)
	);
}
