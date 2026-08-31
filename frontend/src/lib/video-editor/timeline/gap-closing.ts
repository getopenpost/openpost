import type { TimelineItem } from '$lib/video-editor/project/types';
import type { TimeInterval } from './actions/sync-lock-ripple';

export interface TrackGapClosePlan {
	intervals: TimeInterval[];
	updates: Array<{ id: string; from: number }>;
}

function sortedTrackItems(items: readonly TimelineItem[], trackId: string): TimelineItem[] {
	return items
		.filter((item) => item.trackId === trackId)
		.toSorted(
			(left, right) => left.from - right.from || right.durationInFrames - left.durationInFrames
		);
}

export function trackGaps(items: readonly TimelineItem[], trackId: string): TimeInterval[] {
	const gaps: TimeInterval[] = [];
	let occupiedThrough = 0;

	for (const item of sortedTrackItems(items, trackId)) {
		const start = Math.max(0, Math.round(item.from));
		const end = Math.max(start, start + Math.round(item.durationInFrames));
		if (start > occupiedThrough) gaps.push({ start: occupiedThrough, end: start });
		occupiedThrough = Math.max(occupiedThrough, end);
	}

	return gaps;
}

export function findTrackGapAtFrame(
	items: readonly TimelineItem[],
	trackId: string,
	frame: number
): TimeInterval | null {
	const targetFrame = Math.max(0, Math.round(frame));
	return (
		trackGaps(items, trackId).find((gap) => targetFrame >= gap.start && targetFrame < gap.end) ??
		null
	);
}

export function buildTrackGapClosePlan(
	items: readonly TimelineItem[],
	trackId: string,
	frame?: number
): TrackGapClosePlan | null {
	const intervals =
		frame === undefined
			? trackGaps(items, trackId)
			: [findTrackGapAtFrame(items, trackId, frame)].filter(
					(gap): gap is TimeInterval => gap !== null
				);
	if (intervals.length === 0) return null;

	const updates = sortedTrackItems(items, trackId).flatMap((item) => {
		const shift = intervals
			.filter((gap) => gap.end <= item.from)
			.reduce((total, gap) => total + gap.end - gap.start, 0);
		return shift > 0 ? [{ id: item.id, from: Math.max(0, item.from - shift) }] : [];
	});
	return updates.length > 0 ? { intervals, updates } : null;
}
