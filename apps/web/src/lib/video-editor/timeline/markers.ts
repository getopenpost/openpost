import type { TimelineMarker } from '../project/types';

export const DEFAULT_MARKER_COLOR = '#d97746';

// Matches FreeCut's six quick-pick hues while retaining OpenPost's established
// orange marker as the reset value.
export const MARKER_PRESET_COLORS = [
	DEFAULT_MARKER_COLOR,
	'#ef4444',
	'#22c55e',
	'#eab308',
	'#a855f7',
	'#06b6d4'
] as const;

export function markerBefore(markers: TimelineMarker[], frame: number): TimelineMarker | undefined {
	let result: TimelineMarker | undefined;
	for (const marker of markers) {
		if (marker.frame < frame && (!result || marker.frame > result.frame)) result = marker;
	}
	return result;
}

export function markerAfter(markers: TimelineMarker[], frame: number): TimelineMarker | undefined {
	let result: TimelineMarker | undefined;
	for (const marker of markers) {
		if (marker.frame > frame && (!result || marker.frame < result.frame)) result = marker;
	}
	return result;
}

export function markerDisplayName(
	marker: TimelineMarker,
	index: number,
	fallback: (number: number) => string
): string {
	return marker.label?.trim() || fallback(index + 1);
}
