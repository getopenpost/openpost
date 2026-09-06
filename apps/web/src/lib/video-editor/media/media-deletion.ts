import type { ProjectTimeline, TimelineItem } from '../project/types';

export interface MediaDeletionSequencePlan {
	sequenceId: string | null;
	itemIds: string[];
}

export interface MediaDeletionPlan {
	mediaIds: string[];
	sequences: MediaDeletionSequencePlan[];
	rootReferenceCount: number;
	nestedReferenceCount: number;
	totalReferenceCount: number;
}

function itemBelongsToMedia(item: TimelineItem, mediaIds: ReadonlySet<string>): boolean {
	return Boolean(
		(item.mediaId && mediaIds.has(item.mediaId)) ||
		(item.captionSource?.mediaId && mediaIds.has(item.captionSource.mediaId))
	);
}

function matchingItemIds(items: readonly TimelineItem[], mediaIds: ReadonlySet<string>): string[] {
	return items.filter((item) => itemBelongsToMedia(item, mediaIds)).map((item) => item.id);
}

export function planMediaDeletion(
	timeline: ProjectTimeline,
	requestedMediaIds: readonly string[]
): MediaDeletionPlan {
	const mediaIds = [...new Set(requestedMediaIds.filter(Boolean))];
	const mediaIdSet = new Set(mediaIds);
	const rootItemIds = matchingItemIds(timeline.items, mediaIdSet);
	const sequences: MediaDeletionSequencePlan[] = [
		{ sequenceId: null, itemIds: rootItemIds },
		...(timeline.compositions ?? []).map((composition) => ({
			sequenceId: composition.id,
			itemIds: matchingItemIds(composition.items, mediaIdSet)
		}))
	].filter((entry) => entry.itemIds.length > 0);
	const nestedReferenceCount = sequences
		.filter((entry) => entry.sequenceId !== null)
		.reduce((count, entry) => count + entry.itemIds.length, 0);

	return {
		mediaIds,
		sequences,
		rootReferenceCount: rootItemIds.length,
		nestedReferenceCount,
		totalReferenceCount: rootItemIds.length + nestedReferenceCount
	};
}
