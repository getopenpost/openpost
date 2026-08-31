import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { mediaTracks } from './utils/track-groups';

export function emptyTrackIdsForRemoval(
	tracks: readonly TimelineTrack[],
	items: readonly TimelineItem[],
	contextTrackId: string
): string[] {
	const orderedMediaTracks = mediaTracks(tracks).toSorted(
		(left, right) => left.order - right.order
	);
	if (orderedMediaTracks.length <= 1) return [];

	const occupiedTrackIds = new Set(items.map((item) => item.trackId));
	const emptyTrackIds = orderedMediaTracks
		.filter((track) => !occupiedTrackIds.has(track.id))
		.map((track) => track.id);
	if (emptyTrackIds.length < orderedMediaTracks.length) return emptyTrackIds;

	const preservedTrackId = orderedMediaTracks.some((track) => track.id === contextTrackId)
		? contextTrackId
		: orderedMediaTracks[0]?.id;
	return emptyTrackIds.filter((trackId) => trackId !== preservedTrackId);
}
