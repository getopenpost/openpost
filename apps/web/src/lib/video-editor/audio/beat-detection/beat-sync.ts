import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { executeAtomic } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { effectiveMediaTracks } from '$lib/video-editor/timeline/utils/track-groups';
import { getSynchronizedLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
import {
	getMaxTimelineDuration,
	timelineToSourceFrames
} from '$lib/video-editor/timeline/utils/source-calculations';
import { scaleItemKeyframes } from '$lib/video-editor/timeline/edit-constraints';
import { scaleItemVectorKeyframes } from '$lib/video-editor/timeline/vector-keyframes';
import { pruneInvalidTransitions } from '$lib/video-editor/timeline/actions/transitions.svelte';
import { updatesIntroduceExclusiveTrackOverlap } from '$lib/video-editor/timeline/track-occupancy';

export type BeatSyncMode = 'smart' | 'one-per-beat' | 'preserve-duration';
export type BeatCadence = 1 | 2 | 4;

export interface BeatSyncConfig {
	mode: BeatSyncMode;
	cadence: BeatCadence;
	offsetFrames: number;
}

export interface BeatSyncTiming {
	id: string;
	originalFrom: number;
	originalDuration: number;
	from: number;
	durationInFrames: number;
}

export interface BeatSyncResult {
	changed: number;
	skippedLocked: number;
	skippedUnavailable: number;
}

export interface BeatSyncRequest {
	trackIds: readonly string[];
	beatFrames: readonly number[];
	config: BeatSyncConfig;
	excludedItemIds?: readonly string[];
}

export const DEFAULT_BEAT_SYNC_CONFIG: BeatSyncConfig = {
	mode: 'smart',
	cadence: 1,
	offsetFrames: 0
};

const EXCLUDED_SYNC_ITEM_TYPES = new Set<TimelineItem['type']>([
	'adjustment',
	'background',
	'controller'
]);

export function isBeatSyncEligibleItem(item: TimelineItem): boolean {
	return !EXCLUDED_SYNC_ITEM_TYPES.has(item.type);
}

function normalizedBeatFrames(beatFrames: readonly number[], config: BeatSyncConfig): number[] {
	const cadence = config.cadence;
	const unique = [...new Set(beatFrames.map((frame) => Math.max(0, Math.round(frame))))]
		.toSorted((left, right) => left - right)
		.filter((_, index) => index % cadence === 0)
		.map((frame) => Math.max(0, frame + Math.round(config.offsetFrames)));
	return [...new Set(unique)].toSorted((left, right) => left - right);
}

/** Calculate one track's retiming without reading or mutating editor state. */
export function planBeatSync(
	items: readonly TimelineItem[],
	beatFrames: readonly number[],
	config: BeatSyncConfig
): BeatSyncTiming[] {
	const clips = items
		.filter(isBeatSyncEligibleItem)
		.toSorted((left, right) => left.from - right.from || left.id.localeCompare(right.id));
	const beats = normalizedBeatFrames(beatFrames, config);
	if (clips.length === 0 || beats.length === 0) return [];
	if (config.mode !== 'preserve-duration' && beats.length < 2) return [];

	const firstBeat = beats[0] ?? 0;
	const lastBeat = beats.at(-1) ?? firstBeat;
	const averageInterval = beats.length > 1 ? (lastBeat - firstBeat) / (beats.length - 1) : 1;
	const timings: BeatSyncTiming[] = [];
	let beatIndex = 0;

	for (const clip of clips) {
		const start = beats[beatIndex];
		if (start === undefined) break;

		if (config.mode === 'preserve-duration') {
			timings.push({
				id: clip.id,
				originalFrom: clip.from,
				originalDuration: clip.durationInFrames,
				from: start,
				durationInFrames: clip.durationInFrames
			});
			beatIndex += 1;
			continue;
		}

		const beatsToSpan =
			config.mode === 'one-per-beat'
				? 1
				: Math.max(1, Math.round(clip.durationInFrames / Math.max(1, averageInterval)));
		const endIndex = Math.min(beatIndex + beatsToSpan, beats.length - 1);
		const end = beats[endIndex];
		if (end === undefined || end <= start) break;
		timings.push({
			id: clip.id,
			originalFrom: clip.from,
			originalDuration: clip.durationInFrames,
			from: start,
			durationInFrames: Math.max(1, end - start)
		});
		beatIndex = endIndex;
	}

	return timings;
}

function durationPatch(item: TimelineItem, durationInFrames: number): Partial<TimelineItem> {
	if (durationInFrames === item.durationInFrames) return {};
	const patch: Partial<TimelineItem> = {
		durationInFrames,
		keyframes: scaleItemKeyframes(item.keyframes, item.durationInFrames, durationInFrames),
		...(item.vectorKeyframes && {
			vectorKeyframes: scaleItemVectorKeyframes(
				item.vectorKeyframes,
				item.durationInFrames,
				durationInFrames
			)
		})
	};
	if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
		const sourceFps = item.sourceFps ?? timelineStore.fps;
		const sourceStart = item.sourceStart ?? 0;
		const requestedSourceEnd =
			sourceStart +
			timelineToSourceFrames(durationInFrames, item.speed ?? 1, timelineStore.fps, sourceFps);
		patch.sourceEnd = item.sourceDuration
			? Math.min(item.sourceDuration, requestedSourceEnd)
			: requestedSourceEnd;
	}
	return patch;
}

function availableTimelineDuration(item: TimelineItem): number {
	if (
		(item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') ||
		item.sourceDuration === undefined
	) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.max(
		1,
		getMaxTimelineDuration(
			item.sourceDuration,
			item.sourceStart ?? 0,
			item.speed ?? 1,
			item.sourceFps ?? timelineStore.fps,
			timelineStore.fps
		)
	);
}

/** Sync every eligible clip on each chosen track as one undoable edit. */
export function syncTracksToBeatMarkersAtomic(request: BeatSyncRequest): BeatSyncResult {
	const requestedTrackIds = new Set(request.trackIds);
	const excludedItemIds = new Set(request.excludedItemIds ?? []);
	const excludedLinkedGroupIds = new Set(
		timelineStore.items
			.filter((item) => excludedItemIds.has(item.id) && item.linkedGroupId)
			.flatMap((item) => (item.linkedGroupId ? [item.linkedGroupId] : []))
	);
	const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
	const lockedTrackIds = new Set(
		effectiveTracks.filter((track) => track.locked).map((track) => track.id)
	);
	let skippedLocked = 0;
	let skippedUnavailable = 0;
	const timings: BeatSyncTiming[] = [];
	const plannedItemIds = new Set<string>();

	for (const trackId of effectiveTracks.map((track) => track.id)) {
		if (!requestedTrackIds.has(trackId)) continue;
		const trackItems = timelineStore.items.filter(
			(item) =>
				item.trackId === trackId &&
				!plannedItemIds.has(item.id) &&
				!excludedItemIds.has(item.id) &&
				(!item.linkedGroupId || !excludedLinkedGroupIds.has(item.linkedGroupId))
		);
		if (lockedTrackIds.has(trackId)) {
			skippedLocked += trackItems.length;
			continue;
		}
		const trackTimings = planBeatSync(trackItems, request.beatFrames, request.config);
		timings.push(...trackTimings);
		for (const timing of trackTimings) {
			for (const linked of getSynchronizedLinkedItems(timelineStore.items, timing.id)) {
				plannedItemIds.add(linked.id);
			}
		}
	}

	const updates = new Map<string, Partial<TimelineItem>>();
	for (const timing of timings) {
		const anchor = timelineStore.itemById.get(timing.id);
		if (!anchor) {
			skippedUnavailable += 1;
			continue;
		}
		const linked = getSynchronizedLinkedItems(timelineStore.items, anchor.id);
		if (linked.some((item) => excludedItemIds.has(item.id))) {
			skippedUnavailable += linked.length;
			continue;
		}
		if (linked.some((item) => lockedTrackIds.has(item.trackId))) {
			skippedLocked += linked.length;
			continue;
		}
		const durationInFrames = Math.min(
			timing.durationInFrames,
			...linked.map(availableTimelineDuration)
		);
		for (const item of linked) {
			const patch: Partial<TimelineItem> = {
				from: timing.from,
				...durationPatch(item, durationInFrames)
			};
			if (item.from !== timing.from || item.durationInFrames !== durationInFrames) {
				updates.set(item.id, patch);
			}
		}
	}

	if (updates.size === 0) return { changed: 0, skippedLocked, skippedUnavailable };
	const plannedUpdates = [...updates].map(([id, patch]) => ({ id, patch }));
	if (updatesIntroduceExclusiveTrackOverlap(timelineStore.items, plannedUpdates)) {
		return {
			changed: 0,
			skippedLocked,
			skippedUnavailable: skippedUnavailable + updates.size
		};
	}
	return executeAtomic('SYNC_CLIPS_TO_BEATS', () => {
		timelineStore._updateItems(plannedUpdates);
		pruneInvalidTransitions();
		return { changed: updates.size, skippedLocked, skippedUnavailable };
	});
}

/** Split one clip on a beat cadence as one undoable edit. */
export function splitItemOnBeatMarkersAtomic(
	itemId: string,
	beatFrames: readonly number[],
	cadence: BeatCadence
): number {
	const item = timelineStore.itemById.get(itemId);
	if (!item) return 0;
	const linked = getSynchronizedLinkedItems(timelineStore.items, itemId);
	const lockedTrackIds = new Set(
		effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.locked)
			.map((track) => track.id)
	);
	if (linked.some((candidate) => lockedTrackIds.has(candidate.trackId))) return 0;
	const frames = normalizedBeatFrames(beatFrames, {
		mode: 'preserve-duration',
		cadence,
		offsetFrames: 0
	}).filter((frame) => frame > item.from && frame < item.from + item.durationInFrames);
	if (frames.length === 0) return 0;

	return executeAtomic('SPLIT_CLIP_ON_BEATS', () => {
		let count = 0;
		for (const frame of frames.toSorted((left, right) => right - left)) {
			for (const candidate of linked) {
				const split = timelineStore._splitItem(candidate.id, frame);
				if (candidate.id === itemId && split) count += 1;
			}
		}
		return count;
	});
}
