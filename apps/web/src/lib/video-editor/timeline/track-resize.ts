import type { TimelineTrack } from '../project/types';

export const MIN_TRACK_HEIGHT = 48;
export const MAX_TRACK_HEIGHT = 140;

export const TRACK_HEIGHT_ARROW_STEP = 4;
export const TRACK_HEIGHT_SHIFT_STEP = 12;
export const TRACK_HEIGHT_PAGE_STEP = 24;

/**
 * Track-height slider keyboard map. ArrowUp/ArrowDown shrink/grow the track
 * by one step (three steps with shift, matching the drag feel), PageUp/PageDown
 * move by a large step in the same direction as the arrows, and Home/End jump
 * to the height bounds. Returns null for keys the slider does not handle so
 * the caller can ignore them without side effects. The caller clamps through
 * resizeTrackInList/resizeAllTracksInList.
 */
export function nextTrackHeightKeyboard(
	currentHeight: number,
	key: string,
	shiftKey: boolean
): number | null {
	if (key === 'ArrowUp')
		return currentHeight - (shiftKey ? TRACK_HEIGHT_SHIFT_STEP : TRACK_HEIGHT_ARROW_STEP);
	if (key === 'ArrowDown')
		return currentHeight + (shiftKey ? TRACK_HEIGHT_SHIFT_STEP : TRACK_HEIGHT_ARROW_STEP);
	if (key === 'PageUp') return currentHeight - TRACK_HEIGHT_PAGE_STEP;
	if (key === 'PageDown') return currentHeight + TRACK_HEIGHT_PAGE_STEP;
	if (key === 'Home') return MIN_TRACK_HEIGHT;
	if (key === 'End') return MAX_TRACK_HEIGHT;
	return null;
}

/**
 * Screen-reader readout for the track-height resize slider so assistive
 * technology announces e.g. "96 pixels" instead of a bare number,
 * matching the image-editor guide wording ("at {value} pixels").
 */
export function formatTrackHeightText(height: number): string {
	return `${Math.round(height)} pixels`;
}

export function clampTrackHeight(height: number): number {
	return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, Math.round(height)));
}

export function defaultTrackHeight(track: Pick<TimelineTrack, 'kind'>): number {
	return track.kind === 'audio' ? 72 : 96;
}

export function resizeTrackInList(
	tracks: TimelineTrack[],
	trackId: string,
	nextHeight: number
): TimelineTrack[] {
	const height = clampTrackHeight(nextHeight);
	let changed = false;
	const next = tracks.map((track) => {
		if (track.id !== trackId || track.height === height) return track;
		changed = true;
		return { ...track, height };
	});
	return changed ? next : tracks;
}

export function resizeAllTracksInList(
	tracks: TimelineTrack[],
	nextHeight: number
): TimelineTrack[] {
	const height = clampTrackHeight(nextHeight);
	let changed = false;
	const next = tracks.map((track) => {
		if (track.height === height) return track;
		changed = true;
		return { ...track, height };
	});
	return changed ? next : tracks;
}

export function resetTrackHeightsInList(
	tracks: TimelineTrack[],
	trackId: string,
	all: boolean
): TimelineTrack[] {
	let changed = false;
	const next = tracks.map((track) => {
		if (!all && track.id !== trackId) return track;
		const height = defaultTrackHeight(track);
		if (track.height === height) return track;
		changed = true;
		return { ...track, height };
	});
	return changed ? next : tracks;
}
