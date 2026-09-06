import type { TimelineItem } from '$lib/video-editor/project/types';
import { execute } from '../commands/command-store.svelte';
import { isFrameInTransitionRegion } from '../edit-constraints';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { cleanupTrimmedKeyframes, type TrimmedKeyframeCleanupResult } from '../trimmed-keyframes';
import { transitionsStore } from './transitions-store.svelte';

export type TrimAnimationResult =
	| { ok: true; cleanedItems: number; removedCount: number; insertedBoundaryCount: number }
	| { ok: false; reason: 'empty-selection' | 'no-change' | 'transition-blocked' };

interface PreparedCleanup {
	item: TimelineItem;
	cleanup: TrimmedKeyframeCleanupResult;
}

interface PreparedCleanupCollection {
	itemsFound: number;
	cleanups: PreparedCleanup[];
}

/** Remove parked keys beyond selected clips' out points as one undoable edit. */
export function trimAnimationToItemBounds(itemIds: readonly string[]): TrimAnimationResult {
	const prepared = prepareCleanups(itemIds);
	if (prepared.itemsFound === 0) return { ok: false, reason: 'empty-selection' };
	if (prepared.cleanups.length === 0) return { ok: false, reason: 'no-change' };
	if (
		prepared.cleanups.some(
			({ item, cleanup }) =>
				cleanup.insertedBoundaryCount > 0 &&
				isFrameInTransitionRegion(
					Math.max(0, item.durationInFrames - 1),
					item,
					transitionsStore.list
				)
		)
	) {
		return { ok: false, reason: 'transition-blocked' };
	}

	const removedCount = prepared.cleanups.reduce(
		(sum, entry) => sum + entry.cleanup.removedCount,
		0
	);
	const insertedBoundaryCount = prepared.cleanups.reduce(
		(sum, entry) => sum + entry.cleanup.insertedBoundaryCount,
		0
	);
	execute(
		'TRIM_ANIMATION_TO_ITEM_BOUNDS',
		() => {
			timelineStore._updateItems(
				prepared.cleanups.map(({ item, cleanup }) => ({
					id: item.id,
					patch: {
						keyframes: cleanup.keyframes,
						vectorKeyframes: cleanup.vectorKeyframes
					}
				}))
			);
			keyframeSelectionStore.clear();
		},
		{ count: prepared.cleanups.length }
	);
	return {
		ok: true,
		cleanedItems: prepared.cleanups.length,
		removedCount,
		insertedBoundaryCount
	};
}

function prepareCleanups(itemIds: readonly string[]): PreparedCleanupCollection {
	let itemsFound = 0;
	const cleanups: PreparedCleanup[] = [];
	for (const itemId of new Set(itemIds)) {
		const item = timelineStore.itemById.get(itemId);
		if (!item) continue;
		itemsFound += 1;
		const cleanup = cleanupTrimmedKeyframes(item);
		if (cleanup.removedCount > 0) cleanups.push({ item, cleanup });
	}
	return { itemsFound, cleanups };
}
