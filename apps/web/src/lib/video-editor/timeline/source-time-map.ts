import type { EasingType, SpeedRampPoint, TimelineItem } from '../project/types';
import { applyEasing } from './easing';
import { MAX_SPEED, MIN_SPEED } from './utils/source-calculations';

interface SpeedSegment {
	start: number;
	end: number;
	startSpeed: number;
	endSpeed: number;
	easing: EasingType;
	elapsedAtStart: number;
	elapsedAtEnd: number;
}

interface CompiledSourceTimeMap {
	sourceStart: number;
	sourceEnd: number;
	sourceFps: number;
	timelineFps: number;
	segments: SpeedSegment[];
	duration: number;
	startSpeed: number;
	endSpeed: number;
}

interface CachedSourceTimeMap {
	signature: string;
	map: CompiledSourceTimeMap;
}

const compiledMaps = new WeakMap<TimelineItem, CachedSourceTimeMap>();
const INTEGRATION_STEPS = 32;
const INVERSE_STEPS = 28;

function clampSpeed(speed: number | undefined): number {
	if (speed === undefined || !Number.isFinite(speed)) return 1;
	return Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
}

function sourceFpsFor(item: TimelineItem, timelineFps: number): number {
	return item.sourceFps && item.sourceFps > 0 ? item.sourceFps : timelineFps;
}

function sourceEndFor(item: TimelineItem, timelineFps: number, sourceFps: number): number {
	const sourceStart = item.sourceStart ?? 0;
	return (
		item.sourceEnd ??
		sourceStart + (item.durationInFrames / timelineFps) * clampSpeed(item.speed) * sourceFps
	);
}

function rampSignature(item: TimelineItem, timelineFps: number): string {
	return [
		timelineFps,
		item.sourceFps,
		item.sourceStart,
		item.sourceEnd,
		item.durationInFrames,
		item.speed,
		...(item.speedRamp ?? []).flatMap((point) => [
			point.id,
			point.sourceFrame,
			point.speed,
			point.easing
		])
	].join(':');
}

function speedAt(segment: SpeedSegment, sourceFrame: number): number {
	if (segment.easing === 'hold' || segment.end <= segment.start) return segment.startSpeed;
	const progress = (sourceFrame - segment.start) / (segment.end - segment.start);
	const eased = applyEasing(progress, segment.easing);
	return clampSpeed(segment.startSpeed + (segment.endSpeed - segment.startSpeed) * eased);
}

/** Integral of source-frame distance divided by playback rate. */
function integrateSegment(segment: SpeedSegment, sourceFrame: number): number {
	const distance = Math.max(0, Math.min(segment.end, sourceFrame) - segment.start);
	if (distance === 0) return 0;
	if (segment.easing === 'hold') return distance / segment.startSpeed;
	if (segment.easing === 'linear') {
		const fullDistance = segment.end - segment.start;
		const speedDelta = segment.endSpeed - segment.startSpeed;
		if (Math.abs(speedDelta) < 1e-9) return distance / segment.startSpeed;
		const slope = speedDelta / fullDistance;
		const speedAtDistance = segment.startSpeed + slope * distance;
		return Math.log(speedAtDistance / segment.startSpeed) / slope;
	}

	const width = distance / INTEGRATION_STEPS;
	let sum = 1 / speedAt(segment, segment.start) + 1 / speedAt(segment, segment.start + distance);
	for (let index = 1; index < INTEGRATION_STEPS; index += 1) {
		const sampleFrame = segment.start + index * width;
		sum += (index % 2 === 0 ? 2 : 4) / speedAt(segment, sampleFrame);
	}
	return (width / 3) * sum;
}

function normalizePoints(
	item: TimelineItem,
	sourceStart: number,
	sourceEnd: number
): SpeedRampPoint[] {
	const baseSpeed = clampSpeed(item.speed);
	const pointsByFrame = new Map<number, SpeedRampPoint>();
	for (const point of item.speedRamp ?? []) {
		if (
			!Number.isFinite(point.sourceFrame) ||
			point.sourceFrame < sourceStart ||
			point.sourceFrame > sourceEnd
		) {
			continue;
		}
		pointsByFrame.set(point.sourceFrame, { ...point, speed: clampSpeed(point.speed) });
	}
	if (!pointsByFrame.has(sourceStart)) {
		pointsByFrame.set(sourceStart, {
			id: 'source-start',
			sourceFrame: sourceStart,
			speed: baseSpeed,
			easing: 'linear'
		});
	}
	if (!pointsByFrame.has(sourceEnd)) {
		pointsByFrame.set(sourceEnd, {
			id: 'source-end',
			sourceFrame: sourceEnd,
			speed: baseSpeed,
			easing: 'linear'
		});
	}
	return [...pointsByFrame.values()].sort((left, right) => left.sourceFrame - right.sourceFrame);
}

function compileSourceTimeMap(item: TimelineItem, timelineFps: number): CompiledSourceTimeMap {
	const sourceFps = sourceFpsFor(item, timelineFps);
	const sourceStart = item.sourceStart ?? 0;
	const sourceEnd = Math.max(sourceStart, sourceEndFor(item, timelineFps, sourceFps));
	const points = normalizePoints(item, sourceStart, sourceEnd);
	const segments: SpeedSegment[] = [];
	let elapsed = 0;
	for (let index = 0; index < points.length - 1; index += 1) {
		const point = points[index]!;
		const nextPoint = points[index + 1]!;
		const segment: SpeedSegment = {
			start: point.sourceFrame,
			end: nextPoint.sourceFrame,
			startSpeed: point.speed,
			endSpeed: nextPoint.speed,
			easing: point.easing,
			elapsedAtStart: elapsed,
			elapsedAtEnd: elapsed
		};
		elapsed += integrateSegment(segment, segment.end) * (timelineFps / sourceFps);
		segment.elapsedAtEnd = elapsed;
		segments.push(segment);
	}
	return {
		sourceStart,
		sourceEnd,
		sourceFps,
		timelineFps,
		segments,
		duration: elapsed,
		startSpeed: points[0]?.speed ?? clampSpeed(item.speed),
		endSpeed: points.at(-1)?.speed ?? clampSpeed(item.speed)
	};
}

function sourceTimeMap(item: TimelineItem, timelineFps: number): CompiledSourceTimeMap {
	const signature = rampSignature(item, timelineFps);
	const cached = compiledMaps.get(item);
	if (cached?.signature === signature) return cached.map;
	const map = compileSourceTimeMap(item, timelineFps);
	compiledMaps.set(item, { signature, map });
	return map;
}

function timelineElapsedAtSourceFrame(map: CompiledSourceTimeMap, sourceFrame: number): number {
	if (sourceFrame <= map.sourceStart) {
		return ((sourceFrame - map.sourceStart) / map.startSpeed) * (map.timelineFps / map.sourceFps);
	}
	if (sourceFrame >= map.sourceEnd) {
		return (
			map.duration +
			((sourceFrame - map.sourceEnd) / map.endSpeed) * (map.timelineFps / map.sourceFps)
		);
	}
	const segment = map.segments.find(
		(candidate) => sourceFrame >= candidate.start && sourceFrame <= candidate.end
	);
	if (!segment) return 0;
	return (
		segment.elapsedAtStart +
		integrateSegment(segment, sourceFrame) * (map.timelineFps / map.sourceFps)
	);
}

function sourceFrameAtTimelineElapsed(map: CompiledSourceTimeMap, elapsed: number): number {
	if (elapsed <= 0) {
		return map.sourceStart + (elapsed * map.sourceFps * map.startSpeed) / map.timelineFps;
	}
	if (elapsed >= map.duration) {
		return (
			map.sourceEnd + ((elapsed - map.duration) * map.sourceFps * map.endSpeed) / map.timelineFps
		);
	}
	const segment = map.segments.find(
		(candidate) => elapsed >= candidate.elapsedAtStart && elapsed <= candidate.elapsedAtEnd
	);
	if (!segment) return map.sourceStart;
	const segmentElapsed = elapsed - segment.elapsedAtStart;
	if (segment.easing === 'hold') {
		return segment.start + (segmentElapsed * map.sourceFps * segment.startSpeed) / map.timelineFps;
	}

	let low = segment.start;
	let high = segment.end;
	for (let index = 0; index < INVERSE_STEPS; index += 1) {
		const midpoint = (low + high) / 2;
		const midpointElapsed = integrateSegment(segment, midpoint) * (map.timelineFps / map.sourceFps);
		if (midpointElapsed < segmentElapsed) low = midpoint;
		else high = midpoint;
	}
	return (low + high) / 2;
}

function playbackRateAtSourceFrame(
	map: CompiledSourceTimeMap,
	sourceFrame: number,
	reversed: boolean
): number {
	if (sourceFrame <= map.sourceStart) return map.startSpeed;
	if (sourceFrame >= map.sourceEnd) return map.endSpeed;
	const segment = map.segments.find((candidate, index) => {
		if (reversed) return sourceFrame > candidate.start && sourceFrame <= candidate.end;
		return (
			sourceFrame >= candidate.start &&
			(sourceFrame < candidate.end || index === map.segments.length - 1)
		);
	});
	return segment ? speedAt(segment, sourceFrame) : map.startSpeed;
}

export function hasVariableSpeed(item: TimelineItem): boolean {
	return (item.speedRamp?.length ?? 0) > 0;
}

/** Keep a source-anchored speed curve attached to the content during a slip edit. */
export function shiftSpeedRampSourceFrames(
	speedRamp: readonly SpeedRampPoint[] | undefined,
	deltaSourceFrames: number
): SpeedRampPoint[] | undefined {
	if (!speedRamp || speedRamp.length === 0) return undefined;
	return speedRamp.map((point) => ({
		...point,
		sourceFrame: point.sourceFrame + deltaSourceFrames
	}));
}

/** Map a timeline-local frame offset onto the source-native frame domain. */
export function timelineOffsetToSourceFrame(
	item: TimelineItem,
	timelineOffset: number,
	timelineFps: number
): number {
	const map = sourceTimeMap(item, timelineFps);
	const elapsed = item.isReversed ? map.duration - timelineOffset : timelineOffset;
	const sourceFrame = sourceFrameAtTimelineElapsed(map, elapsed);
	return item.isReversed ? sourceFrame - 1 : sourceFrame;
}

/** Inverse of the persisted curve, used by transcript, silence, and beat edits. */
export function sourceFrameToTimelineOffset(
	item: TimelineItem,
	sourceFrame: number,
	timelineFps: number
): number {
	const map = sourceTimeMap(item, timelineFps);
	const elapsed = timelineElapsedAtSourceFrame(map, sourceFrame);
	return item.isReversed ? map.duration - elapsed : elapsed;
}

export function playbackRateAtTimelineOffset(
	item: TimelineItem,
	timelineOffset: number,
	timelineFps: number
): number {
	if (!hasVariableSpeed(item)) return clampSpeed(item.speed);
	const map = sourceTimeMap(item, timelineFps);
	const elapsed = item.isReversed ? map.duration - timelineOffset : timelineOffset;
	const sourceFrame = sourceFrameAtTimelineElapsed(map, elapsed);
	return playbackRateAtSourceFrame(map, sourceFrame, item.isReversed === true);
}

export interface PlaybackRateCurvePoint {
	offsetFrames: number;
	rate: number;
}

export function variableSpeedSplitBoundaries(
	item: TimelineItem,
	timelineOffset: number,
	timelineFps: number
): {
	left: { sourceStart: number; sourceEnd: number };
	right: { sourceStart: number; sourceEnd: number };
} {
	const splitSourceFrame = Math.round(
		timelineOffsetToSourceFrame(item, timelineOffset, timelineFps) + (item.isReversed ? 1 : 0)
	);
	const sourceStart = item.sourceStart ?? 0;
	const sourceEnd = item.sourceEnd ?? splitSourceFrame;
	return item.isReversed
		? {
				left: { sourceStart: splitSourceFrame, sourceEnd },
				right: { sourceStart, sourceEnd: splitSourceFrame }
			}
		: {
				left: { sourceStart, sourceEnd: splitSourceFrame },
				right: { sourceStart: splitSourceFrame, sourceEnd }
			};
}

/** A compact output-time curve for streaming audio preview and export. */
export function playbackRateCurve(
	item: TimelineItem,
	timelineFps: number
): PlaybackRateCurvePoint[] {
	if (!hasVariableSpeed(item)) return [];
	const map = sourceTimeMap(item, timelineFps);
	const points: Array<PlaybackRateCurvePoint & { order: number }> = [];
	for (let segmentIndex = 0; segmentIndex < map.segments.length; segmentIndex += 1) {
		const segment = map.segments[segmentIndex]!;
		for (let sample = 0; sample <= 16; sample += 1) {
			const sourceFrame = segment.start + ((segment.end - segment.start) * sample) / 16;
			const elapsed = timelineElapsedAtSourceFrame(map, sourceFrame);
			points.push({
				offsetFrames: item.isReversed ? map.duration - elapsed : elapsed,
				rate: speedAt(segment, sourceFrame),
				order: segmentIndex * 17 + sample
			});
		}
	}
	points.sort((left, right) => {
		const byOffset = left.offsetFrames - right.offsetFrames;
		if (Math.abs(byOffset) > 1e-9) return byOffset;
		return item.isReversed ? right.order - left.order : left.order - right.order;
	});
	for (let start = 0; start < points.length;) {
		let end = start + 1;
		while (
			end < points.length &&
			Math.abs(points[end]!.offsetFrames - points[start]!.offsetFrames) < 1e-9
		) {
			end += 1;
		}
		for (let index = start; index < end - 1; index += 1) {
			points[index]!.offsetFrames = Math.max(
				0,
				points[index]!.offsetFrames - (end - 1 - index) * 1e-7
			);
		}
		start = end;
	}
	return points.map(({ offsetFrames, rate }) => ({ offsetFrames, rate }));
}

export function variableSpeedDurationInFrames(item: TimelineItem, timelineFps: number): number {
	return sourceTimeMap(item, timelineFps).duration;
}
