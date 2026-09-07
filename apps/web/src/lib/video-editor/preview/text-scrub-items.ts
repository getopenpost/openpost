import type { TimelineItem } from '../project/types';

/**
 * Pure selection behind the text-scrub overlay: the text/subtitle items whose
 * time window covers the scrub frame, in timeline order. Resolution and
 * rasterization stay in the overlay component; this stays unit-testable.
 */
export function visibleScrubTextItems(
	items: readonly TimelineItem[],
	frame: number
): TimelineItem[] {
	if (!Number.isFinite(frame)) return [];
	const safeFrame = Math.max(0, Math.round(frame));
	return items.filter(
		(item) =>
			(item.type === 'text' || item.type === 'subtitle') &&
			Number.isFinite(item.from) &&
			Number.isFinite(item.durationInFrames) &&
			safeFrame >= item.from &&
			safeFrame < item.from + item.durationInFrames
	);
}
