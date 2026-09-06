import type { TimelineTrack } from '../../project/types';

export interface EffectiveTrackState {
	locked: boolean;
	visible: boolean;
	muted: boolean;
	solo: boolean;
}

export function isTrackGroup(track: TimelineTrack): boolean {
	return track.isGroup === true;
}

export function mediaTracks(tracks: readonly TimelineTrack[]): TimelineTrack[] {
	return tracks.filter((track) => !isTrackGroup(track));
}

export function trackChildren(tracks: readonly TimelineTrack[], groupId: string): TimelineTrack[] {
	return tracks
		.filter((track) => !isTrackGroup(track) && track.parentTrackId === groupId)
		.sort((left, right) => left.order - right.order);
}

export function effectiveTrackState(
	track: TimelineTrack,
	tracks: readonly TimelineTrack[]
): EffectiveTrackState {
	const parent = track.parentTrackId
		? tracks.find((candidate) => candidate.id === track.parentTrackId && isTrackGroup(candidate))
		: undefined;
	return {
		locked: track.locked || Boolean(parent?.locked),
		visible: track.visible !== false && parent?.visible !== false,
		muted: track.muted || Boolean(parent?.muted),
		solo: track.solo || Boolean(parent?.solo)
	};
}

export function effectiveMediaTracks(tracks: readonly TimelineTrack[]): TimelineTrack[] {
	return mediaTracks(tracks).map((track) => ({ ...track, ...effectiveTrackState(track, tracks) }));
}

export function isTrackEffectivelyLocked(
	trackId: string,
	tracks: readonly TimelineTrack[]
): boolean {
	const track = tracks.find((candidate) => candidate.id === trackId);
	return track ? effectiveTrackState(track, tracks).locked : false;
}

/**
 * Returns display rows with children directly below their group. A collapsed
 * group only changes the timeline layout. Media remains active.
 */
export function visibleTrackRows(tracks: readonly TimelineTrack[]): TimelineTrack[] {
	const sorted = [...tracks].sort((left, right) => left.order - right.order);
	const groupIds = new Set(sorted.filter(isTrackGroup).map((track) => track.id));
	const childIds = new Set(
		sorted
			.filter((track) => track.parentTrackId && groupIds.has(track.parentTrackId))
			.map((track) => track.id)
	);
	const rows: TimelineTrack[] = [];
	for (const track of sorted) {
		if (childIds.has(track.id)) continue;
		rows.push(track);
		if (!isTrackGroup(track) || track.isCollapsed) continue;
		rows.push(...trackChildren(sorted, track.id));
	}
	return rows;
}

/** Repair invalid, nested, or orphaned hierarchy without dropping media. */
export function normalizeTrackGroups(tracks: readonly TimelineTrack[]): TimelineTrack[] {
	const groups = new Set(tracks.filter(isTrackGroup).map((track) => track.id));
	const normalized: TimelineTrack[] = tracks.map((track) => {
		if (isTrackGroup(track)) {
			const { parentTrackId: _parentTrackId, kind: _kind, ...group } = track;
			return {
				...group,
				isGroup: true,
				height: Math.max(88, Math.min(112, track.height || 96)),
				visible: track.visible !== false,
				locked: Boolean(track.locked),
				muted: Boolean(track.muted),
				solo: Boolean(track.solo)
			};
		}
		if (!track.parentTrackId || groups.has(track.parentTrackId)) return track;
		const { parentTrackId: _parentTrackId, ...orphan } = track;
		return orphan;
	});
	const populatedGroupIds = new Set(
		normalized
			.filter((track) => !isTrackGroup(track) && track.parentTrackId)
			.map((track) => track.parentTrackId)
	);
	return normalized.filter((track) => !isTrackGroup(track) || populatedGroupIds.has(track.id));
}

export function renumberTrackOrder(tracks: readonly TimelineTrack[]): TimelineTrack[] {
	return tracks.map((track, order) => ({ ...track, order }));
}
