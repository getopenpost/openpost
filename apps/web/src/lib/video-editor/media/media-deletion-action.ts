import { sequenceStore } from '../sequences/sequence-store.svelte';
import { removeItemsForMediaDeletion } from '../timeline/actions/items';
import type { MediaDeletionPlan } from './media-deletion';

export function removePlannedMediaReferences(plan: MediaDeletionPlan): number {
	if (plan.totalReferenceCount === 0) return 0;
	const originalSequenceId = sequenceStore.activeSequenceId;
	let removedCount = 0;

	try {
		for (const sequence of plan.sequences) {
			if (!sequenceStore.switchTo(sequence.sequenceId)) continue;
			removedCount += removeItemsForMediaDeletion(sequence.itemIds).length;
		}
	} finally {
		sequenceStore.switchTo(originalSequenceId);
	}

	return removedCount;
}
