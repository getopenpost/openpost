/** Undoable timeline track creation, removal, and state controls. */

import type { TimelineTrack } from '../../project/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { isTrackSyncLockActive } from '../utils/track-sync-lock';
import {
	isTrackGroup,
	mediaTracks,
	normalizeTrackGroups,
	renumberTrackOrder,
	trackChildren
} from '../utils/track-groups';
import { emptyTrackIdsForRemoval } from '../track-removal';
import { pruneOrphanedTransitions } from './transitions.svelte';

export type TrackKind = NonNullable<TimelineTrack['kind']>;

function updateTrack(id: string, patch: Partial<TimelineTrack>, commandType: string): boolean {
	return execute(commandType, () => {
		const current = timelineStore.tracks.find((track) => track.id === id);
		if (!current) return false;
		timelineStore._setTracks(
			timelineStore.tracks.map((track) => (track.id === id ? { ...track, ...patch } : track))
		);
		return true;
	});
}

export function addTrack(kind: TrackKind, name: string): string {
	return execute('ADD_TRACK', () => {
		const orders = timelineStore.tracks.map((track) => track.order);
		const order =
			kind === 'video'
				? (orders.length > 0 ? Math.min(...orders) : 0) - 1
				: (orders.length > 0 ? Math.max(...orders) : -1) + 1;
		const track: TimelineTrack = {
			id: crypto.randomUUID(),
			name,
			kind,
			height: kind === 'video' ? 96 : 72,
			locked: false,
			syncLock: true,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order
		};
		timelineStore._setTracks([...timelineStore.tracks, track]);
		return track.id;
	});
}

export function createTrackGroup(trackIds: readonly string[], name: string): string | null {
	const uniqueIds = [...new Set(trackIds)];
	const selected = timelineStore.tracks
		.filter((track) => uniqueIds.includes(track.id) && !isTrackGroup(track))
		.sort((left, right) => left.order - right.order);
	if (selected.length === 0) return null;
	return execute('CREATE_TRACK_GROUP', () => {
		const groupId = crypto.randomUUID();
		const selectedIds = new Set(selected.map((track) => track.id));
		const ordered = [...timelineStore.tracks].sort((left, right) => left.order - right.order);
		const firstIndex = ordered.findIndex((track) => selectedIds.has(track.id));
		const group: TimelineTrack = {
			id: groupId,
			name,
			isGroup: true,
			isCollapsed: false,
			height: 96,
			locked: false,
			syncLock: true,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order: 0
		};
		const before = ordered.slice(0, firstIndex).filter((track) => !selectedIds.has(track.id));
		const after = ordered.slice(firstIndex).filter((track) => !selectedIds.has(track.id));
		let next = [
			...before,
			group,
			...selected.map((track) => ({ ...track, parentTrackId: groupId })),
			...after
		];
		const populatedGroupIds = new Set(
			next.filter((track) => track.parentTrackId).map((track) => track.parentTrackId)
		);
		next = next.filter((track) => !isTrackGroup(track) || populatedGroupIds.has(track.id));
		timelineStore._setTracks(renumberTrackOrder(next));
		return groupId;
	});
}

export function toggleTrackGroupCollapsed(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track && isTrackGroup(track)
		? updateTrack(id, { isCollapsed: !track.isCollapsed }, 'TOGGLE_TRACK_GROUP_COLLAPSED')
		: false;
}

export function renameTrack(id: string, name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	if (!track || track.name === trimmed) return false;
	return updateTrack(id, { name: trimmed }, 'RENAME_TRACK');
}

export function moveTrack(id: string, direction: -1 | 1): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	if (!track) return false;
	const ordered = [...timelineStore.tracks].sort((left, right) => left.order - right.order);
	if (track.parentTrackId) {
		const siblings = trackChildren(ordered, track.parentTrackId);
		const index = siblings.findIndex((candidate) => candidate.id === id);
		const other = siblings[index + direction];
		if (!other) return false;
		return execute('MOVE_TRACK', () => {
			timelineStore._setTracks(
				ordered.map((candidate) =>
					candidate.id === track.id
						? { ...candidate, order: other.order }
						: candidate.id === other.id
							? { ...candidate, order: track.order }
							: candidate
				)
			);
			return true;
		});
	}

	const topLevel = ordered.filter((candidate) => !candidate.parentTrackId);
	const index = topLevel.findIndex((candidate) => candidate.id === id);
	const targetIndex = index + direction;
	if (index < 0 || targetIndex < 0 || targetIndex >= topLevel.length) return false;
	const reordered = [...topLevel];
	[reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!];
	const flattened = reordered.flatMap((candidate) =>
		isTrackGroup(candidate) ? [candidate, ...trackChildren(ordered, candidate.id)] : [candidate]
	);
	return execute('MOVE_TRACK_BLOCK', () => {
		timelineStore._setTracks(renumberTrackOrder(flattened));
		return true;
	});
}

export function ungroupTracks(id: string): boolean {
	const group = timelineStore.tracks.find((track) => track.id === id);
	if (!group || !isTrackGroup(group)) return false;
	return execute('UNGROUP_TRACKS', () => {
		const next = timelineStore.tracks
			.filter((track) => track.id !== id)
			.map((track) => {
				if (track.parentTrackId !== id) return track;
				const { parentTrackId: _parentTrackId, ...child } = track;
				return child;
			});
		timelineStore._setTracks(renumberTrackOrder(next.sort((a, b) => a.order - b.order)));
		return true;
	});
}

export function removeTrackGroupWithContents(id: string): boolean {
	const group = timelineStore.tracks.find((track) => track.id === id);
	if (!group || !isTrackGroup(group)) return false;
	const children = trackChildren(timelineStore.tracks, id);
	const removingTrackIds = new Set(children.map((track) => track.id));
	if (mediaTracks(timelineStore.tracks).length - removingTrackIds.size < 1) return false;
	return execute('REMOVE_TRACK_GROUP_WITH_CONTENTS', () => {
		timelineStore._setTracks(
			renumberTrackOrder(
				timelineStore.tracks
					.filter((track) => track.id !== id && !removingTrackIds.has(track.id))
					.sort((a, b) => a.order - b.order)
			)
		);
		timelineStore._removeItems(
			timelineStore.items
				.filter((item) => removingTrackIds.has(item.trackId))
				.map((item) => item.id)
		);
		pruneOrphanedTransitions();
		return true;
	});
}

export function removeTrack(id: string): boolean {
	const target = timelineStore.tracks.find((track) => track.id === id);
	if (!target) return false;
	if (isTrackGroup(target)) return ungroupTracks(id);
	if (mediaTracks(timelineStore.tracks).length <= 1) {
		return false;
	}
	return execute('REMOVE_TRACK', () => {
		const parentId = target.parentTrackId;
		let next = timelineStore.tracks.filter((track) => track.id !== id);
		if (parentId && trackChildren(next, parentId).length === 0) {
			next = next.filter((track) => track.id !== parentId);
		}
		timelineStore._setTracks(renumberTrackOrder(next.sort((a, b) => a.order - b.order)));
		timelineStore._removeItems(
			timelineStore.items.filter((item) => item.trackId === id).map((item) => item.id)
		);
		pruneOrphanedTransitions();
		return true;
	});
}

export function removeEmptyTracks(contextTrackId: string): string[] {
	const removingIds = emptyTrackIdsForRemoval(
		timelineStore.tracks,
		timelineStore.items,
		contextTrackId
	);
	if (removingIds.length === 0) return [];
	const removingSet = new Set(removingIds);

	return execute('REMOVE_EMPTY_TRACKS', () => {
		const remainingTracks = normalizeTrackGroups(
			timelineStore.tracks.filter((track) => !removingSet.has(track.id))
		);
		timelineStore._setTracks(
			renumberTrackOrder(remainingTracks.toSorted((left, right) => left.order - right.order))
		);
		return removingIds;
	});
}

export function toggleTrackLock(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { locked: !track.locked }, 'TOGGLE_TRACK_LOCK') : false;
}

export function toggleTrackVisibility(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { visible: !track.visible }, 'TOGGLE_TRACK_VISIBILITY') : false;
}

export function toggleTrackMute(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { muted: !track.muted }, 'TOGGLE_TRACK_MUTE') : false;
}

export function toggleTrackSolo(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track ? updateTrack(id, { solo: !track.solo }, 'TOGGLE_TRACK_SOLO') : false;
}

export function toggleTrackSyncLock(id: string): boolean {
	const track = timelineStore.tracks.find((candidate) => candidate.id === id);
	return track
		? updateTrack(id, { syncLock: !isTrackSyncLockActive(track) }, 'TOGGLE_TRACK_SYNC_LOCK')
		: false;
}
