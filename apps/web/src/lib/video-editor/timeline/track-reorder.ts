import type { TimelineTrack } from '../project/types';
import { isTrackGroup, renumberTrackOrder, trackChildren } from './utils/track-groups';

/** Move within the same group, keeping top-level groups and their children together. */
export function reorderTrackList(
	tracks: readonly TimelineTrack[],
	id: string,
	targetId: string
): TimelineTrack[] | null {
	const track = tracks.find((track) => track.id === id);
	const target = tracks.find((track) => track.id === targetId);
	if (!track || !target || id === targetId || track.parentTrackId !== target.parentTrackId)
		return null;
	const ordered = tracks.toSorted((left, right) => left.order - right.order);
	const siblings = ordered.filter((candidate) => candidate.parentTrackId === track.parentTrackId);
	const from = siblings.findIndex((candidate) => candidate.id === id);
	const to = siblings.findIndex((candidate) => candidate.id === targetId);
	siblings.splice(from, 1);
	siblings.splice(to, 0, track);
	if (track.parentTrackId) {
		let index = 0;
		return renumberTrackOrder(
			ordered.map((candidate) =>
				candidate.parentTrackId === track.parentTrackId ? siblings[index++]! : candidate
			)
		);
	}
	return renumberTrackOrder(
		siblings.flatMap((candidate) =>
			isTrackGroup(candidate) ? [candidate, ...trackChildren(ordered, candidate.id)] : [candidate]
		)
	);
}
