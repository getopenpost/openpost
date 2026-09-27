import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { clonePropertyRuntime } from './property-runtime-clone';
import { isTrackEffectivelyLocked } from './utils/track-groups';

export function planRepeatedItems(options: {
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions: readonly TimelineTransition[];
	selectedIds: readonly string[];
	copies: number;
	gapFrames: number;
	endFrame?: number;
}): {
	items: TimelineItem[];
	transitions: TimelineTransition[];
	endFrame: number;
} | null {
	const { items, tracks, selectedIds, copies, gapFrames, endFrame } = options;
	if (
		!Number.isInteger(copies) ||
		copies < 1 ||
		copies > 100 ||
		!Number.isInteger(gapFrames) ||
		gapFrames < 0
	)
		return null;
	const selection = items.filter((item) => selectedIds.includes(item.id));
	if (!selection.length || selection.some((item) => isTrackEffectivelyLocked(item.trackId, tracks)))
		return null;
	const start = Math.min(...selection.map((item) => item.from));
	const end = Math.max(...selection.map((item) => item.from + item.durationInFrames));
	const stride = end - start + gapFrames;
	const finalEnd = end + stride * copies;
	if (endFrame !== undefined && finalEnd > endFrame) return null;
	const planned: TimelineItem[] = [];
	const transitions: TimelineTransition[] = [];
	for (let copy = 1; copy <= copies; copy++) {
		const itemMap = new Map(selection.map((item) => [item.id, crypto.randomUUID()]));
		const groups = new Map<string, string>();
		for (const item of selection) {
			const from = item.from + stride * copy;
			if (
				items.some(
					(other) =>
						other.trackId === item.trackId &&
						other.from < from + item.durationInFrames &&
						other.from + other.durationInFrames > from
				)
			)
				return null;
			if (item.linkedGroupId && !groups.has(item.linkedGroupId))
				groups.set(item.linkedGroupId, crypto.randomUUID());
			const id = itemMap.get(item.id)!;
			planned.push({
				...structuredClone(item),
				...clonePropertyRuntime(item, itemMap),
				id,
				originId: id,
				from,
				linkedGroupId: item.linkedGroupId ? groups.get(item.linkedGroupId) : undefined
			});
		}
		for (const transition of options.transitions) {
			const fromItemId = itemMap.get(transition.fromItemId);
			const toItemId = itemMap.get(transition.toItemId);
			if (fromItemId && toItemId)
				transitions.push({
					...structuredClone(transition),
					id: crypto.randomUUID(),
					fromItemId,
					toItemId
				});
		}
	}
	return { items: planned, transitions, endFrame: finalEnd };
}
