import type { TimelineItem } from '../project/types';

function sourceKey(item: TimelineItem): string | undefined {
	return item.compositionId ?? item.mediaId;
}

/** True when two adjacent clips still form one continuous split-source window. */
export function canJoinItems(left: TimelineItem, right: TimelineItem): boolean {
	if (!left.originId || left.originId !== right.originId) return false;
	if (left.type !== right.type || left.trackId !== right.trackId) return false;
	if (!sourceKey(left) || sourceKey(left) !== sourceKey(right)) return false;
	if (left.from + left.durationInFrames !== right.from) return false;
	if ((left.speed ?? 1) !== (right.speed ?? 1)) return false;
	if (left.isReversed !== right.isReversed) return false;

	const continuousBoundary = left.isReversed
		? Math.abs((left.sourceStart ?? 0) - (right.sourceEnd ?? 0))
		: Math.abs((left.sourceEnd ?? 0) - (right.sourceStart ?? 0));
	return continuousBoundary <= 0.5;
}

export function canJoinMultipleItems(items: TimelineItem[]): boolean {
	if (items.length < 2) return false;
	const sorted = items.toSorted((left, right) => left.from - right.from);
	return sorted.slice(1).every((item, index) => canJoinItems(sorted[index]!, item));
}

export interface JoinableItemNeighbors {
	previous?: TimelineItem;
	next?: TimelineItem;
}

/** Resolve the continuous split siblings immediately before and after one clip. */
export function joinableItemNeighbors(
	items: readonly TimelineItem[],
	item: TimelineItem
): JoinableItemNeighbors {
	const previous = items
		.filter((candidate) => canJoinItems(candidate, item))
		.toSorted((left, right) => right.from - left.from || left.id.localeCompare(right.id))[0];
	const next = items
		.filter((candidate) => canJoinItems(item, candidate))
		.toSorted((left, right) => left.from - right.from || left.id.localeCompare(right.id))[0];
	return { previous, next };
}

/** Merge one validated chain while preserving the first timeline item's identity. */
export function joinedTimelineItem(items: TimelineItem[]): TimelineItem | null {
	const sorted = items.toSorted((left, right) => left.from - right.from);
	if (!canJoinMultipleItems(sorted)) return null;
	const first = sorted[0]!;
	const last = sorted[sorted.length - 1]!;
	return {
		...first,
		durationInFrames: last.from + last.durationInFrames - first.from,
		sourceStart: first.isReversed ? last.sourceStart : first.sourceStart,
		sourceEnd: first.isReversed ? first.sourceEnd : last.sourceEnd
	};
}
