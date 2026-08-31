import type { TimelineItem } from '../project/types';
import { queryTimelineItemRange, type TimelineItemRangeIndex } from './timeline-viewport';

export const WAVEFORM_PREFETCH_AHEAD_PX = 800;
export const WAVEFORM_PREFETCH_BEHIND_PX = 200;

export interface WaveformDemandInput {
	items?: readonly TimelineItem[];
	itemIndex?: TimelineItemRangeIndex;
	scrollLeft: number;
	previousScrollLeft: number;
	viewportWidth: number;
	headerWidth: number;
	pixelsPerFrame: number;
}

interface RankedDemand {
	mediaId: string;
	band: number;
	distance: number;
}

/**
 * Pick waveform sources in visible-first order, then bias prefetch toward the
 * current scroll direction. Clips outside the bounded pixel window do no work.
 *
 * Adapted from FreeCut (MIT) - timeline/hooks/use-waveform-prefetch.ts.
 */
export function planTimelineWaveformDemand(input: WaveformDemandInput): string[] {
	if (!(input.viewportWidth > input.headerWidth) || !(input.pixelsPerFrame > 0)) return [];
	const movingRight = input.scrollLeft >= input.previousScrollLeft;
	const visibleStart = input.scrollLeft + input.headerWidth;
	const visibleEnd = input.scrollLeft + input.viewportWidth;
	const demandStart = Math.max(
		input.headerWidth,
		visibleStart - (movingRight ? WAVEFORM_PREFETCH_BEHIND_PX : WAVEFORM_PREFETCH_AHEAD_PX)
	);
	const demandEnd =
		visibleEnd + (movingRight ? WAVEFORM_PREFETCH_AHEAD_PX : WAVEFORM_PREFETCH_BEHIND_PX);
	const viewportCenter = (visibleStart + visibleEnd) / 2;
	const bestByMediaId = new Map<string, RankedDemand>();
	const items = input.itemIndex
		? queryTimelineItemRange(input.itemIndex, {
				start: (demandStart - input.headerWidth) / input.pixelsPerFrame,
				end: (demandEnd - input.headerWidth) / input.pixelsPerFrame
			})
		: (input.items ?? []);

	for (const item of items) {
		if ((item.type !== 'video' && item.type !== 'audio') || !item.mediaId) continue;
		const start = input.headerWidth + item.from * input.pixelsPerFrame;
		const end = start + item.durationInFrames * input.pixelsPerFrame;
		if (end <= demandStart || start >= demandEnd) continue;
		const visible = end > visibleStart && start < visibleEnd;
		const ahead = movingRight ? start >= visibleEnd : end <= visibleStart;
		const band = visible ? 0 : ahead ? 1 : 2;
		const distance = Math.abs((start + end) / 2 - viewportCenter);
		const candidate = { mediaId: item.mediaId, band, distance };
		const current = bestByMediaId.get(item.mediaId);
		if (
			!current ||
			candidate.band < current.band ||
			(candidate.band === current.band && candidate.distance < current.distance)
		) {
			bestByMediaId.set(item.mediaId, candidate);
		}
	}

	return [...bestByMediaId.values()]
		.sort(
			(left, right) =>
				left.band - right.band ||
				left.distance - right.distance ||
				left.mediaId.localeCompare(right.mediaId)
		)
		.map((entry) => entry.mediaId);
}
