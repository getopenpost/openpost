import type { TimelineItem, TimelineTrack } from '../project/types';
import { hasLinkedAudioCompanion, findLinkedAudioCompanion } from '../audio/transition-crossfade';
import {
	sourceSecondsToTimelineFrame,
	getMediaSourceFps
} from '../timeline/utils/media-item-frames';
import { timelineOffsetToSourceFrame } from '../timeline/source-time-map';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';

export interface RecordingReviewRange {
	sourceItemId: string;
	start: number;
	end: number;
	kind: 'pause' | 'filler' | 'retake';
}

type Interval = { start: number; end: number };

function sameAudioSource(a: TimelineItem, b: TimelineItem, items: TimelineItem[]): boolean {
	return (
		a.id === b.id ||
		findLinkedAudioCompanion(a, items)?.id === b.id ||
		findLinkedAudioCompanion(b, items)?.id === a.id
	);
}

/** Include linked sources whose speech would be cut, sharing analysis for exact A/V companions. */
export function recordingAnalysisItemIds(
	items: readonly TimelineItem[],
	itemIds: readonly string[]
): string[] {
	const selected = new Set(itemIds);
	const groups = new Set(
		items
			.filter((item) => selected.has(item.id))
			.flatMap((item) => (item.linkedGroupId ? [item.linkedGroupId] : []))
	);
	const allItems = [...items];
	const result: TimelineItem[] = [];
	const candidates = [
		...items.filter((item) => selected.has(item.id)),
		...items.filter(
			(item) => !selected.has(item.id) && item.linkedGroupId && groups.has(item.linkedGroupId)
		)
	];
	for (const item of candidates) {
		if ((item.type !== 'audio' && item.type !== 'video') || !item.mediaId) continue;
		if (result.some((candidate) => sameAudioSource(candidate, item, allItems))) continue;
		result.push(item);
	}
	return result.map((item) => item.id);
}

/** Capture a value, not mutable store references; callers publish it with a completed review. */
export function recordingReviewFingerprint(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[],
	itemIds: readonly string[],
	fps: number
): string {
	return JSON.stringify({ items, tracks, itemIds, fps });
}

function timelineRange(item: TimelineItem, range: Interval, fps: number): Interval | null {
	if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start)
		return null;
	const first = sourceSecondsToTimelineFrame(item, range.start, fps);
	const last = sourceSecondsToTimelineFrame(item, range.end, fps);
	const start = Math.max(item.from, Math.min(first, last));
	const end = Math.min(item.from + item.durationInFrames, Math.max(first, last));
	return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function merge(intervals: Interval[]): Interval[] {
	const result: Interval[] = [];
	for (const interval of intervals.toSorted((a, b) => a.start - b.start)) {
		const previous = result.at(-1);
		if (previous && interval.start <= previous.end)
			previous.end = Math.max(previous.end, interval.end);
		else result.push({ ...interval });
	}
	return result;
}

function intersect(left: Interval[], right: Interval[]): Interval[] {
	return merge(
		left.flatMap((a) =>
			right.flatMap((b) => {
				const start = Math.max(a.start, b.start);
				const end = Math.min(a.end, b.end);
				return end > start ? [{ start, end }] : [];
			})
		)
	);
}

function sourceBoundary(item: TimelineItem, frame: number, fps: number): number {
	// The player returns the preceding sample for reversed frames. Cuts use exclusive boundaries.
	return (
		Math.round(
			timelineOffsetToSourceFrame(item, frame - item.from, fps) + (item.isReversed ? 1 : 0)
		) / getMediaSourceFps(item, fps)
	);
}

function sourceInterval(item: TimelineItem, interval: Interval, fps: number): Interval | null {
	const first = sourceBoundary(item, interval.start, fps);
	const last = sourceBoundary(item, interval.end, fps);
	const result = { start: Math.min(first, last), end: Math.max(first, last) };
	const mapped = timelineRange(item, result, fps);
	if (!mapped) return null;
	const sourceFrame = 1 / getMediaSourceFps(item, fps);
	if (mapped.start < interval.start) {
		if (item.isReversed) result.end -= sourceFrame;
		else result.start += sourceFrame;
	}
	if (mapped.end > interval.end) {
		if (item.isReversed) result.start += sourceFrame;
		else result.end -= sourceFrame;
	}
	const admitted = timelineRange(item, result, fps);
	return admitted && admitted.start >= interval.start && admitted.end <= interval.end
		? result
		: null;
}

/** Count each linked edit once, using playback duration rather than source-media seconds. */
export function selectedRecordingDuration(
	items: readonly TimelineItem[],
	itemIds: readonly string[],
	fps: number,
	ranges: readonly RecordingReviewRange[]
): number {
	if (!Number.isFinite(fps) || fps <= 0) return 0;
	const selected = new Set(itemIds);
	const byId = new Map(items.map((item) => [item.id, item]));
	const groups = new Map<string, Interval[]>();
	for (const range of ranges) {
		const item = byId.get(range.sourceItemId);
		if (!item || !selected.has(item.id)) continue;
		const mapped = timelineRange(item, range, fps);
		if (!mapped) continue;
		const key = item.linkedGroupId ?? item.id;
		groups.set(key, [...(groups.get(key) ?? []), mapped]);
	}
	return (
		[...groups.values()].reduce(
			(total, intervals) =>
				total + merge(intervals).reduce((sum, interval) => sum + interval.end - interval.start, 0),
			0
		) / fps
	);
}

/** Only offer pauses proved silent by every retained linked audio owner. */
export function protectRecordingRanges<T extends RecordingReviewRange>(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[],
	itemIds: readonly string[],
	fps: number,
	ranges: readonly T[]
): T[] {
	if (!Number.isFinite(fps) || fps <= 0) return [];
	const selected = new Set(itemIds);
	const byId = new Map(items.map((item) => [item.id, item]));
	const effectiveTracks = new Map(effectiveMediaTracks(tracks).map((track) => [track.id, track]));
	const anySolo = [...effectiveTracks.values()].some((track) => track.solo);
	const allItems = [...items];
	const silence = new Map<string, Interval[]>();
	for (const range of ranges) {
		const item = byId.get(range.sourceItemId);
		if (!item || range.kind !== 'pause') continue;
		const mapped = timelineRange(item, range, fps);
		if (mapped) silence.set(item.id, [...(silence.get(item.id) ?? []), mapped]);
	}
	const result: T[] = [];
	for (const range of ranges) {
		const item = byId.get(range.sourceItemId);
		if (!item || !selected.has(item.id) || (item.type !== 'video' && item.type !== 'audio'))
			continue;
		const group = item.linkedGroupId
			? items.filter((candidate) => candidate.linkedGroupId === item.linkedGroupId)
			: [item];
		// The cut owner skips locked members, which would leave a recording out of sync.
		if (
			group.some(
				(candidate) =>
					!effectiveTracks.has(candidate.trackId) || effectiveTracks.get(candidate.trackId)?.locked
			)
		)
			continue;
		const owners = group.filter((candidate) => {
			const track = effectiveTracks.get(candidate.trackId);
			return (
				(candidate.type === 'audio' || candidate.type === 'video') &&
				!candidate.audioDetached &&
				!hasLinkedAudioCompanion(candidate, allItems) &&
				track &&
				!track.muted &&
				track.visible !== false &&
				(!anySolo || track.solo)
			);
		});
		if (!owners.length || (range.kind !== 'pause' && owners.length > 1)) continue;
		const mapped = timelineRange(item, range, fps);
		if (!mapped) continue;
		let safe = [mapped];
		if (range.kind === 'pause') {
			for (const owner of owners) {
				// Outside this owner's active span it cannot contribute speech. Missing analysis
				// inside that span is not silence, including a failed decoder or absent transcript.
				const ownerSilence = group
					.filter((candidate) => sameAudioSource(owner, candidate, allItems))
					.flatMap((candidate) => silence.get(candidate.id) ?? []);
				const allowed = [
					{ start: Number.NEGATIVE_INFINITY, end: owner.from },
					...ownerSilence,
					{ start: owner.from + owner.durationInFrames, end: Number.POSITIVE_INFINITY }
				];
				safe = intersect(safe, allowed);
				if (!safe.length) break;
			}
		}
		for (const interval of safe) {
			const source = sourceInterval(item, interval, fps);
			if (source) result.push({ ...range, ...source });
		}
	}
	return result;
}
