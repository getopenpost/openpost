import type { TimelineTrack } from '../project/types';

export const MIN_TRACK_HEIGHT = 48;
export const MAX_TRACK_HEIGHT = 140;

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
