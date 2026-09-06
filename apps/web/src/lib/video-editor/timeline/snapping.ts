/**
 * Pure timeline snapping rules shared by move, trim, and later edit tools.
 *
 * Ported from FreeCut (MIT) timeline-snap-utils.ts and use-snap-calculator.ts,
 * adapted to OpenPost frame-native coordinates and transition model.
 */

import type {
	TimelineItem,
	TimelineMarker,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { resolveTransitionWindow } from './transition-planner';
import { effectiveMediaTracks } from './utils/track-groups';

export const BASE_SNAP_THRESHOLD_PIXELS = 8;

export type SnapTargetType = 'grid' | 'item-start' | 'item-end' | 'playhead' | 'marker';

export interface SnapTarget {
	frame: number;
	type: SnapTargetType;
	itemId?: string;
	markerId?: string;
}

export interface SnapResult {
	snappedFrame: number;
	snapTarget: SnapTarget | null;
	didSnap: boolean;
}

const sortedSnapTargets = new WeakSet<SnapTarget[]>();

export function calculateAdaptiveSnapThreshold(
	zoomLevel: number,
	pixelsPerFrame: number,
	baseThresholdPixels = BASE_SNAP_THRESHOLD_PIXELS
): number {
	const safeZoom = Math.max(0.01, zoomLevel);
	const safePixelsPerFrame = Math.max(0.001, pixelsPerFrame);
	const thresholdPixels = baseThresholdPixels / Math.sqrt(safeZoom);
	return Math.max(1, Math.ceil(thresholdPixels / safePixelsPerFrame));
}

export function generateGridSnapPoints(
	durationInFrames: number,
	fps: number,
	zoomLevel: number
): number[] {
	const intervalSeconds = zoomLevel > 2 ? 1 : zoomLevel > 0.5 ? 5 : 10;
	const intervalFrames = Math.max(1, Math.round(intervalSeconds * fps));
	const points: number[] = [];
	for (let frame = 0; frame <= durationInFrames; frame += intervalFrames) points.push(frame);
	return points;
}

function targetPriority(target: SnapTarget): number {
	switch (target.type) {
		case 'item-start':
		case 'item-end':
			return 4;
		case 'marker':
			return 3;
		case 'playhead':
			return 2;
		default:
			return 1;
	}
}

export function findNearestSnapTarget(
	targetFrame: number,
	snapTargets: SnapTarget[],
	thresholdFrames: number
): SnapTarget | null {
	let nearest: SnapTarget | null = null;
	let nearestDistance = thresholdFrames;
	let startIndex = 0;
	let endIndex = snapTargets.length;
	if (sortedSnapTargets.has(snapTargets)) {
		const minimumFrame = targetFrame - thresholdFrames;
		const maximumFrame = targetFrame + thresholdFrames;
		let low = 0;
		let high = snapTargets.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (snapTargets[middle]!.frame <= minimumFrame) low = middle + 1;
			else high = middle;
		}
		startIndex = low;
		low = startIndex;
		high = snapTargets.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (snapTargets[middle]!.frame < maximumFrame) low = middle + 1;
			else high = middle;
		}
		endIndex = low;
	}
	for (let index = startIndex; index < endIndex; index++) {
		const target = snapTargets[index]!;
		const distance = Math.abs(targetFrame - target.frame);
		if (
			distance < nearestDistance ||
			(distance === nearestDistance && nearest && targetPriority(target) > targetPriority(nearest))
		) {
			nearest = target;
			nearestDistance = distance;
		}
	}
	return nearest;
}

export function calculateMoveSnap(
	targetStartFrame: number,
	itemDurationInFrames: number,
	snapTargets: SnapTarget[],
	thresholdFrames: number
): SnapResult {
	const targetEndFrame = targetStartFrame + itemDurationInFrames;
	const nearestStart = findNearestSnapTarget(targetStartFrame, snapTargets, thresholdFrames);
	const nearestEnd = findNearestSnapTarget(targetEndFrame, snapTargets, thresholdFrames);
	const startDistance = nearestStart ? Math.abs(targetStartFrame - nearestStart.frame) : Infinity;
	const endDistance = nearestEnd ? Math.abs(targetEndFrame - nearestEnd.frame) : Infinity;

	if (startDistance < endDistance && nearestStart) {
		return {
			snappedFrame: nearestStart.frame,
			snapTarget: nearestStart,
			didSnap: true
		};
	}
	if (nearestEnd) {
		return {
			snappedFrame: nearestEnd.frame - itemDurationInFrames,
			snapTarget: nearestEnd,
			didSnap: true
		};
	}
	return { snappedFrame: targetStartFrame, snapTarget: null, didSnap: false };
}

export function calculateEdgeSnap(
	targetFrame: number,
	snapTargets: SnapTarget[],
	thresholdFrames: number
): SnapResult {
	const target = findNearestSnapTarget(targetFrame, snapTargets, thresholdFrames);
	return target
		? { snappedFrame: target.frame, snapTarget: target, didSnap: true }
		: { snappedFrame: targetFrame, snapTarget: null, didSnap: false };
}

interface ItemSnapTargetOptions {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	excludeItemIds?: string[];
}

function buildItemSnapTargets(options: ItemSnapTargetOptions): SnapTarget[] {
	const excluded = new Set(options.excludeItemIds ?? []);
	const visibleTrackIds = new Set(
		effectiveMediaTracks(options.tracks)
			.filter((track) => track.visible !== false)
			.map((track) => track.id)
	);
	const itemById = new Map(options.items.map((item) => [item.id, item]));
	const suppressEnd = new Set<string>();
	const suppressStart = new Set<string>();
	const targets: SnapTarget[] = [];

	for (const transition of options.transitions) {
		suppressEnd.add(transition.fromItemId);
		suppressStart.add(transition.toItemId);
		const from = itemById.get(transition.fromItemId);
		const to = itemById.get(transition.toItemId);
		if (
			from &&
			to &&
			visibleTrackIds.has(from.trackId) &&
			visibleTrackIds.has(to.trackId) &&
			!excluded.has(from.id) &&
			!excluded.has(to.id)
		) {
			const window = resolveTransitionWindow(transition, from, to);
			if (!window) continue;
			targets.push({
				frame: window.startFrame + Math.floor(window.durationInFrames / 2),
				type: 'item-start',
				itemId: to.id
			});
		}
	}

	for (const item of options.items) {
		if (!visibleTrackIds.has(item.trackId) || excluded.has(item.id)) continue;
		if (!suppressStart.has(item.id)) {
			targets.push({ frame: item.from, type: 'item-start', itemId: item.id });
		}
		if (!suppressEnd.has(item.id)) {
			targets.push({
				frame: item.from + item.durationInFrames,
				type: 'item-end',
				itemId: item.id
			});
		}
	}
	return targets;
}

export interface TimelineNavigationSnapPointOptions extends ItemSnapTargetOptions {
	markers: TimelineMarker[];
}

export function timelineNavigationSnapPoints(
	options: TimelineNavigationSnapPointOptions
): number[] {
	const points = new Set(buildItemSnapTargets(options).map((target) => target.frame));
	for (const marker of options.markers) points.add(marker.frame);
	return [...points].toSorted((left, right) => left - right);
}

interface BuildSnapTargetsOptions extends TimelineNavigationSnapPointOptions {
	currentFrame: number;
	durationInFrames: number;
	fps: number;
	zoomLevel: number;
}

export function buildSnapTargets(options: BuildSnapTargetsOptions): SnapTarget[] {
	const targets = buildItemSnapTargets(options);

	for (const frame of generateGridSnapPoints(
		options.durationInFrames,
		options.fps,
		options.zoomLevel
	)) {
		targets.push({ frame, type: 'grid' });
	}
	for (const marker of options.markers) {
		targets.push({ frame: marker.frame, type: 'marker', markerId: marker.id });
	}
	targets.push({ frame: options.currentFrame, type: 'playhead' });
	targets.sort((left, right) => left.frame - right.frame);
	sortedSnapTargets.add(targets);
	return targets;
}
