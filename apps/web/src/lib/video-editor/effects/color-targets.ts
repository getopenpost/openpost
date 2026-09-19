import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';

export function isColorGradeTargetEditable(
	item: TimelineItem,
	tracks: readonly TimelineTrack[]
): boolean {
	return (
		(item.type === 'adjustment' && item.sequenceColorGrade === true) ||
		!isTrackEffectivelyLocked(item.trackId, tracks)
	);
}

export function resolveVisualColorTargetIds(
	itemId: string | null,
	selectedItemIds: readonly string[],
	itemsById: ReadonlyMap<string, TimelineItem>
): string[] {
	if (!itemId) return [];
	const requested = selectedItemIds.includes(itemId) ? selectedItemIds : [itemId];
	return [...new Set(requested)].filter((id) => {
		const item = itemsById.get(id);
		return item !== undefined && item.type !== 'audio';
	});
}

export function resolveEditableColorTargetIds(
	itemId: string | null,
	selectedItemIds: readonly string[],
	itemsById: ReadonlyMap<string, TimelineItem>,
	tracks: readonly TimelineTrack[]
): string[] {
	return resolveVisualColorTargetIds(itemId, selectedItemIds, itemsById).filter((id) => {
		const item = itemsById.get(id);
		return item !== undefined && isColorGradeTargetEditable(item, tracks);
	});
}
