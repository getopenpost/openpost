import type {
	TextMotionEffect,
	TextMotionSlot,
	TextMotionSpec,
	TimelineItem
} from '../../project/types';
import type { TimelineSnapshot } from '../commands/types';
import { captureSnapshot } from '../commands/snapshot.svelte';
import { commandHistory, execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';

export interface TextMotionAssignment {
	itemId: string;
	slot: TextMotionSlot;
	effect: TextMotionEffect;
}

export interface TextMotionEffectUpdate {
	durationFrames?: number;
	offsetFrames?: number;
	staggerFrames?: number;
	intensity?: number;
	order?: TextMotionEffect['order'];
	easing?: TextMotionEffect['easing'];
	unit?: TextMotionEffect['unit'];
}

function assignedSpec(
	existing: TextMotionSpec | undefined,
	slot: TextMotionSlot,
	effect: TextMotionEffect
): TextMotionSpec {
	return { ...existing, [slot]: { ...effect } };
}

export function applyTextMotionToItems(assignments: readonly TextMotionAssignment[]): number {
	const valid = assignments.filter(
		({ itemId }) => timelineStore.itemById.get(itemId)?.type === 'text'
	);
	if (valid.length === 0) return 0;
	return execute('APPLY_TEXT_MOTION', () => {
		const specs = new Map<string, TextMotionSpec>();
		for (const { itemId, slot, effect } of valid) {
			const item = timelineStore.itemById.get(itemId)!;
			specs.set(itemId, assignedSpec(specs.get(itemId) ?? item.textMotion, slot, effect));
		}
		const updates = [...specs].map(([id, textMotion]) => ({ id, patch: { textMotion } }));
		timelineStore._updateItems(updates);
		return updates.length;
	});
}

export function removeTextMotionFromItems(
	itemIds: readonly string[],
	slot: TextMotionSlot
): number {
	const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
	for (const itemId of new Set(itemIds)) {
		const item = timelineStore.itemById.get(itemId);
		if (item?.type !== 'text' || !item.textMotion?.[slot]) continue;
		const next = { ...item.textMotion };
		delete next[slot];
		updates.push({
			id: itemId,
			patch: { textMotion: Object.keys(next).length > 0 ? next : undefined }
		});
	}
	if (updates.length === 0) return 0;
	return execute('REMOVE_TEXT_MOTION', () => {
		timelineStore._updateItems(updates);
		return updates.length;
	});
}

export function updateTextMotionLive(
	itemIds: readonly string[],
	slot: TextMotionSlot,
	update: TextMotionEffectUpdate
): number {
	const updates = [...new Set(itemIds)].flatMap((itemId) => {
		const item = timelineStore.itemById.get(itemId);
		const effect = item?.type === 'text' ? item.textMotion?.[slot] : undefined;
		if (!item || !effect) return [];
		return [
			{
				id: itemId,
				patch: { textMotion: assignedSpec(item.textMotion, slot, clampedEffect(effect, update)) }
			}
		];
	});
	if (updates.length > 0) timelineStore._updateItems(updates);
	return updates.length;
}

export function beginTextMotionEdit(): TimelineSnapshot {
	return captureSnapshot();
}

export function commitTextMotionEdit(
	before: TimelineSnapshot,
	slot: TextMotionSlot,
	itemIds: readonly string[]
): void {
	commandHistory.addUndoEntry(
		{ type: 'UPDATE_TEXT_MOTION', payload: { slot, ids: [...itemIds] } },
		before
	);
}

function clampedEffect(effect: TextMotionEffect, update: TextMotionEffectUpdate): TextMotionEffect {
	return {
		...effect,
		...update,
		...(update.durationFrames !== undefined && {
			durationFrames: Math.max(1, Math.round(update.durationFrames))
		}),
		...(update.offsetFrames !== undefined && {
			offsetFrames: Math.max(0, Math.round(update.offsetFrames))
		}),
		...(update.staggerFrames !== undefined && {
			staggerFrames: Math.max(0, Math.min(30, Math.round(update.staggerFrames)))
		}),
		...(update.intensity !== undefined && {
			intensity: Math.max(0, Math.min(2, update.intensity))
		})
	};
}
