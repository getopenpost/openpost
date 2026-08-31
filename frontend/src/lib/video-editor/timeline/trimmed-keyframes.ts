/** Explicit cleanup for animation parked past a clip's current out point. */
import type {
	AnimationKeyframeSource,
	ItemKeyframes,
	ItemVectorKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	TimelineItem,
	VectorKeyframe,
	VectorKeyframeProperty
} from '$lib/video-editor/project/types';
import { interpolateAt } from './keyframe-interpolation';
import { interpolateVector } from './vector-keyframes';

export interface TrimmedKeyframeCleanupResult {
	keyframes: ItemKeyframes | undefined;
	vectorKeyframes: ItemVectorKeyframes | undefined;
	removedCount: number;
	insertedBoundaryCount: number;
}

export function countTrimmedKeyframes(item: TimelineItem): number {
	let count = 0;
	for (const track of Object.values(item.keyframes ?? {})) {
		if (track) count += track.frames.filter((frame) => frame >= item.durationInFrames).length;
	}
	for (const track of Object.values(item.vectorKeyframes ?? {})) {
		count += track?.filter((keyframe) => keyframe.frame >= item.durationInFrames).length ?? 0;
	}
	return count;
}

/**
 * Consolidate animation to the current duration. Ordinary trims never call
 * this, so extending a clip still restores parked keys until the user opts in.
 */
export function cleanupTrimmedKeyframes(
	item: TimelineItem,
	createId: () => string = () => crypto.randomUUID()
): TrimmedKeyframeCleanupResult {
	const boundaryFrame = Math.max(0, item.durationInFrames - 1);
	const nextKeyframes: ItemKeyframes = { ...item.keyframes };
	let removedCount = 0;
	let insertedBoundaryCount = 0;

	for (const rawProperty of Object.keys(item.keyframes ?? {})) {
		// SAFETY: ItemKeyframes only permits KeyframeProperty keys.
		const property = rawProperty as KeyframeProperty;
		const track = item.keyframes?.[property];
		if (!track) continue;
		const cleanup = cleanupScalarTrack(
			track,
			boundaryFrame,
			interpolateAt(item, property, boundaryFrame) ?? track.values[0] ?? 0,
			createId
		);
		if (cleanup.removedCount === 0) continue;
		nextKeyframes[property] = cleanup.track;
		removedCount += cleanup.removedCount;
		insertedBoundaryCount += cleanup.insertedBoundary ? 1 : 0;
	}

	let vectorKeyframes = item.vectorKeyframes;
	for (const property of ['position', 'scale', 'anchor'] as const) {
		const source = item.vectorKeyframes?.[property];
		if (!source) continue;
		const cleanup = cleanupVector(source, boundaryFrame, createId);
		if (cleanup.removedCount > 0) {
			vectorKeyframes = { ...vectorKeyframes, [property]: cleanup.keyframes };
			removedCount += cleanup.removedCount;
			insertedBoundaryCount += cleanup.insertedBoundary ? 1 : 0;
		}
	}

	return {
		keyframes: Object.keys(nextKeyframes).length > 0 ? nextKeyframes : undefined,
		vectorKeyframes,
		removedCount,
		insertedBoundaryCount
	};
}

interface TrackEntry {
	frame: number;
	value: number;
	id: string;
	easing: NonNullable<KeyframeTrack['easings']>[number];
	easingConfig: NonNullable<KeyframeTrack['easingConfigs']>[number];
	source: AnimationKeyframeSource | null;
}

interface ScalarTrackCleanup {
	track: KeyframeTrack;
	removedCount: number;
	insertedBoundary: boolean;
}

interface VectorCleanup {
	keyframes: VectorKeyframe[];
	removedCount: number;
	insertedBoundary: boolean;
}

function cleanupScalarTrack(
	track: KeyframeTrack,
	boundaryFrame: number,
	boundaryValue: number,
	createId: () => string
): ScalarTrackCleanup {
	const sorted = trackEntries(track, createId).toSorted((left, right) => left.frame - right.frame);
	const removedCount = sorted.filter((entry) => entry.frame > boundaryFrame).length;
	if (removedCount === 0) return { track, removedCount: 0, insertedBoundary: false };

	const kept = sorted.filter((entry) => entry.frame <= boundaryFrame);
	let insertedBoundary = false;
	if (!kept.some((entry) => entry.frame === boundaryFrame)) {
		const template = kept.at(-1) ?? sorted.find((entry) => entry.frame > boundaryFrame);
		kept.push({
			frame: boundaryFrame,
			value: boundaryValue,
			id: createId(),
			easing: template?.easing ?? 'linear',
			easingConfig: template?.easingConfig ?? null,
			source: template?.source ?? null
		});
		insertedBoundary = true;
	}
	return { track: entriesToTrack(kept), removedCount, insertedBoundary };
}

function trackEntries(track: KeyframeTrack, createId: () => string): TrackEntry[] {
	return track.frames.map((frame, index) => ({
		frame,
		value: track.values[index] ?? 0,
		id: track.ids?.[index] ?? createId(),
		easing: track.easings?.[index] ?? 'linear',
		easingConfig: track.easingConfigs?.[index] ?? null,
		source: track.sources?.[index] ?? null
	}));
}

function entriesToTrack(entries: readonly TrackEntry[]): KeyframeTrack {
	return {
		frames: entries.map((entry) => entry.frame),
		values: entries.map((entry) => entry.value),
		ids: entries.map((entry) => entry.id),
		easings: entries.map((entry) => entry.easing),
		easingConfigs: entries.map((entry) => entry.easingConfig),
		sources: entries.map((entry) => entry.source)
	};
}

function cleanupVector(
	keyframes: readonly VectorKeyframe[],
	boundaryFrame: number,
	createId: () => string
): VectorCleanup {
	const sorted = [...keyframes].toSorted((left, right) => left.frame - right.frame);
	const removedCount = sorted.filter((keyframe) => keyframe.frame > boundaryFrame).length;
	if (removedCount === 0) {
		return { keyframes: [...keyframes], removedCount: 0, insertedBoundary: false };
	}

	const kept = sorted.filter((keyframe) => keyframe.frame <= boundaryFrame);
	if (kept.some((keyframe) => keyframe.frame === boundaryFrame)) {
		return { keyframes: kept, removedCount, insertedBoundary: false };
	}
	const template = kept.at(-1) ?? sorted.find((keyframe) => keyframe.frame > boundaryFrame);
	const value = interpolateVector(sorted, boundaryFrame) ?? template?.value ?? { x: 0, y: 0 };
	kept.push({
		id: createId(),
		frame: boundaryFrame,
		value,
		easing: template?.easing ?? 'linear',
		...(template?.source && { source: template.source }),
		...(template?.easingConfig && { easingConfig: { ...template.easingConfig } })
	});
	return { keyframes: kept, removedCount, insertedBoundary: true };
}
