import type { TimelineItem } from '../../project/types';
import { trimClipCaptions } from '../../transcript/split-transcript-captions';
import { execute } from '../commands/command-store.svelte';
import { planTrimGesture } from '../edit-gesture';
import { timelineStore } from '../stores/timeline-store.svelte';
import { getSynchronizedLinkedItems } from '../utils/linked-items';
import { isTrackEffectivelyLocked } from '../utils/track-groups';
import type { TrimHandle } from '../utils/trim-utils';
import { transitionsStore } from './transitions-store.svelte';

function prepareTrim(itemId: string, edge: TrimHandle) {
	const item = timelineStore.itemById.get(itemId);
	const frame = timelineStore.currentFrame;
	if (
		!item ||
		!['video', 'audio', 'image', 'composition'].includes(item.type) ||
		frame <= item.from ||
		frame >= item.from + item.durationInFrames
	)
		return null;
	const participants = getSynchronizedLinkedItems(timelineStore.items, itemId);
	const ids = new Set(participants.map((participant) => participant.id));
	if (
		timelineStore.items.some(
			(candidate) =>
				(ids.has(candidate.id) ||
					(candidate.captionSource && ids.has(candidate.captionSource.clipId))) &&
				isTrackEffectivelyLocked(candidate.trackId, timelineStore.tracks)
		)
	)
		return null;
	const transitions = transitionsStore.list.filter(
		(transition) => !ids.has(edge === 'start' ? transition.toItemId : transition.fromItemId)
	);
	const delta = frame - (edge === 'start' ? item.from : item.from + item.durationInFrames);
	const plan = planTrimGesture(
		item,
		edge,
		delta,
		timelineStore.items,
		timelineStore.fps,
		[],
		0,
		transitions
	);
	const end = item.from + (plan.patch.durationInFrames ?? item.durationInFrames);
	if ((edge === 'start' ? plan.patch.from : end) !== frame) return null;
	return {
		updates: [{ id: item.id, patch: plan.patch }, ...(plan.linkedPatches ?? [])],
		transitions
	};
}

export function canTrimItemToPlayhead(itemId: string, edge: TrimHandle): boolean {
	return prepareTrim(itemId, edge) !== null;
}

/** A trim leaves the rest of the sequence in place and keeps the selected clip's identity. */
export function trimItemToPlayhead(itemId: string, edge: TrimHandle): boolean {
	const plan = prepareTrim(itemId, edge);
	if (!plan) return false;
	return execute(edge === 'start' ? 'TRIM_ITEM_START' : 'TRIM_ITEM_END', () => {
		let items: TimelineItem[] = timelineStore.items;
		for (const update of plan.updates) {
			const original = timelineStore.itemById.get(update.id)!;
			const trimmed = { ...original, ...update.patch };
			items = trimClipCaptions(items, original, trimmed, timelineStore.fps);
		}
		const updates = new Map(plan.updates.map((update) => [update.id, update.patch]));
		timelineStore._setItems(
			items.map((item) => (updates.has(item.id) ? { ...item, ...updates.get(item.id) } : item))
		);
		transitionsStore.setAll(plan.transitions);
		return true;
	});
}
