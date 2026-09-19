import type { AudioSilenceRange } from '$lib/video-editor/audio/audio-silence';
import { MIN_SEGMENT_DURATION_SECONDS } from './model';
import type { QuickCutSegment } from './types';

/** Subtract in source time, keeping sequence order and earlier edits intact. */
export function removeSourceRanges(
	segments: readonly QuickCutSegment[],
	sourceId: string,
	ranges: readonly AudioSilenceRange[]
): QuickCutSegment[] {
	const valid = ranges.filter(
		(range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start
	);
	return segments.flatMap((segment) => {
		if (segment.sourceId !== sourceId || segment.enabled === false) return [segment];
		let parts = [{ start: segment.start, end: segment.end }];
		let changed = false;
		for (const range of valid) {
			parts = parts.flatMap((part) => {
				if (range.end <= part.start || range.start >= part.end) return [part];
				changed = true;
				const remaining: AudioSilenceRange[] = [];
				if (range.start > part.start) remaining.push({ start: part.start, end: range.start });
				if (range.end < part.end) remaining.push({ start: range.end, end: part.end });
				return remaining;
			});
		}
		if (!changed) return [segment];
		return parts
			.filter((part) => part.end - part.start >= MIN_SEGMENT_DURATION_SECONDS)
			.map((part, index) => ({
				...segment,
				...part,
				id: index === 0 ? segment.id : crypto.randomUUID(),
				cutMode: 'exact' as const
			}));
	});
}
