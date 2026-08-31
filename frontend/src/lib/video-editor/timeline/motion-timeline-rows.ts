/**
 * Motion timeline layer planning.
 *
 * Ported from FreeCut (MIT) - editor/components/compose-workspace/
 * compositing-timeline.tsx. The planner hides linked audio companions behind
 * their visual layer and turns track groups into deterministic display rows.
 */

import type { TimelineItem, TimelineTrack } from '../project/types';

export interface MotionTimelineLayerRow {
	kind: 'layer';
	item: TimelineItem;
	track: TimelineTrack | undefined;
	depth: 0 | 1;
	/** Every document item edited through this visible layer. */
	itemIds: string[];
}

export interface MotionTimelineGroupRow {
	kind: 'group';
	track: TimelineTrack;
	/** Visible layer anchors contained by the group, including collapsed rows. */
	itemIds: string[];
}

export type MotionTimelineRow = MotionTimelineLayerRow | MotionTimelineGroupRow;

export interface MotionTimelinePlan {
	rows: MotionTimelineRow[];
	/** Internal selection lookup. Callers should use expandMotionLayerItemIds. */
	itemIdsByItemId: ReadonlyMap<string, readonly string[]>;
}

interface MotionLayerEntry {
	item: TimelineItem;
	track: TimelineTrack | undefined;
	itemIds: string[];
}

function linkedAudioIndexes(items: readonly TimelineItem[]) {
	const byGroupId = new Map<string, TimelineItem>();
	const byCompositionGroupId = new Map<string, TimelineItem>();
	for (const item of items) {
		if (item.type !== 'audio' || !item.linkedGroupId) continue;
		if (!byGroupId.has(item.linkedGroupId)) byGroupId.set(item.linkedGroupId, item);
		if (!item.compositionId) continue;
		const key = `${item.linkedGroupId}\u0000${item.compositionId}`;
		if (!byCompositionGroupId.has(key)) byCompositionGroupId.set(key, item);
	}
	return { byGroupId, byCompositionGroupId };
}

function linkedAudioCompanion(
	indexes: ReturnType<typeof linkedAudioIndexes>,
	anchor: TimelineItem
): TimelineItem | null {
	if ((anchor.type !== 'video' && anchor.type !== 'composition') || !anchor.linkedGroupId) {
		return null;
	}
	if (anchor.type === 'composition') {
		if (!anchor.compositionId) return null;
		return (
			indexes.byCompositionGroupId.get(`${anchor.linkedGroupId}\u0000${anchor.compositionId}`) ??
			null
		);
	}
	return indexes.byGroupId.get(anchor.linkedGroupId) ?? null;
}

function layerEntries(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[]
): MotionLayerEntry[] {
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	const audioIndexes = linkedAudioIndexes(items);
	const companionByAnchorId = new Map<string, TimelineItem>();
	const hiddenCompanionIds = new Set<string>();
	for (const item of items) {
		const companion = linkedAudioCompanion(audioIndexes, item);
		if (!companion) continue;
		companionByAnchorId.set(item.id, companion);
		hiddenCompanionIds.add(companion.id);
	}

	return items
		.filter((item) => item.type !== 'subtitle' && !hiddenCompanionIds.has(item.id))
		.map((item) => {
			const companion = companionByAnchorId.get(item.id);
			return {
				item,
				track: trackById.get(item.trackId),
				itemIds: companion ? [item.id, companion.id] : [item.id]
			};
		})
		.toSorted(
			(left, right) =>
				(left.track?.order ?? Number.MAX_SAFE_INTEGER) -
					(right.track?.order ?? Number.MAX_SAFE_INTEGER) ||
				left.item.from - right.item.from ||
				left.item.id.localeCompare(right.item.id)
		);
}

export function planMotionTimelineRows(input: {
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
}): MotionTimelinePlan {
	const entries = layerEntries(input.items, input.tracks);
	const entriesByTrackId = new Map<string, MotionLayerEntry[]>();
	const itemIdsByItemId = new Map<string, readonly string[]>();
	for (const entry of entries) {
		const trackEntries = entriesByTrackId.get(entry.item.trackId) ?? [];
		trackEntries.push(entry);
		entriesByTrackId.set(entry.item.trackId, trackEntries);
		for (const itemId of entry.itemIds) itemIdsByItemId.set(itemId, entry.itemIds);
	}

	const rows: MotionTimelineRow[] = [];
	const emittedItemIds = new Set<string>();
	const sortedTracks = input.tracks.toSorted(
		(left, right) => left.order - right.order || left.id.localeCompare(right.id)
	);
	for (const track of sortedTracks.filter((candidate) => !candidate.parentTrackId)) {
		if (track.isGroup) {
			const childTracks = sortedTracks.filter((candidate) => candidate.parentTrackId === track.id);
			const childEntries = childTracks.flatMap((child) => entriesByTrackId.get(child.id) ?? []);
			rows.push({
				kind: 'group',
				track,
				itemIds: childEntries.map((entry) => entry.item.id)
			});
			for (const entry of childEntries) {
				emittedItemIds.add(entry.item.id);
				if (!track.isCollapsed) {
					rows.push({ kind: 'layer', ...entry, depth: 1 });
				}
			}
			continue;
		}

		for (const entry of entriesByTrackId.get(track.id) ?? []) {
			emittedItemIds.add(entry.item.id);
			rows.push({ kind: 'layer', ...entry, depth: 0 });
		}
	}

	for (const entry of entries) {
		if (emittedItemIds.has(entry.item.id)) continue;
		rows.push({ kind: 'layer', ...entry, depth: entry.track?.parentTrackId ? 1 : 0 });
	}

	return { rows, itemIdsByItemId };
}

/** Expand visible Motion layer ids to every linked document item once. */
export function expandMotionLayerItemIds(
	plan: MotionTimelinePlan,
	itemIds: readonly string[]
): string[] {
	const expanded: string[] = [];
	const seen = new Set<string>();
	for (const itemId of itemIds) {
		for (const linkedId of plan.itemIdsByItemId.get(itemId) ?? [itemId]) {
			if (seen.has(linkedId)) continue;
			seen.add(linkedId);
			expanded.push(linkedId);
		}
	}
	return expanded;
}
