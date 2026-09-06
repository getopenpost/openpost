/** Insert one detected source scene as an exact trimmed timeline clip. */

import type { TimelineItem, TimelineTrack } from '../../project/types';
import { execute } from '../../timeline/commands/command-store.svelte';
import { timelineStore } from '../../timeline/stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../../timeline/utils/track-groups';
import type { MediaMetadata } from '../types';
import type { MediaScene } from './types';
import { m } from '$lib/paraglide/messages';
import { insertMediaAtFrame } from '../../timeline/actions/insert-media';

function collides(trackId: string, from: number, end: number): boolean {
	return (timelineStore.itemsByTrackId.get(trackId) ?? []).some(
		(item) => item.from < end && item.from + item.durationInFrames > from
	);
}

function targetTrack(from: number, end: number, preferredTrackId?: string): TimelineTrack {
	const tracks = effectiveMediaTracks(timelineStore.tracks);
	const preferred = preferredTrackId
		? tracks.find((track) => track.id === preferredTrackId)
		: undefined;
	if (preferred?.kind === 'video' && !preferred.locked && !collides(preferred.id, from, end)) {
		return preferred;
	}
	const unlocked = tracks
		.filter((track) => track.kind === 'video' && !track.locked)
		.toSorted((left, right) => right.order - left.order);
	const open = unlocked.find((track) => !collides(track.id, from, end));
	if (open) return open;
	const order = Math.min(0, ...timelineStore.tracks.map((track) => track.order)) - 1;
	return {
		id: crypto.randomUUID(),
		name: m.video_editor_scenes(),
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

export function insertSceneAtFrame(
	scene: MediaScene,
	media: MediaMetadata,
	from: number,
	preferredTrackId?: string
): string {
	if (media.tags.includes('image') || media.mimeType.startsWith('image/')) {
		return insertMediaAtFrame(media, from, {
			preferredTrackId,
			label: scene.text || media.fileName
		});
	}
	return execute('INSERT_SCENE', () => {
		const timelineFps = timelineStore.fps;
		const sourceFps = media.fps > 0 ? media.fps : timelineFps;
		const durationInFrames = Math.max(1, Math.round((scene.endSec - scene.startSec) * timelineFps));
		const safeFrom = Math.max(0, Math.round(from));
		const track = targetTrack(safeFrom, safeFrom + durationInFrames, preferredTrackId);
		if (!timelineStore.tracks.some((candidate) => candidate.id === track.id)) {
			timelineStore._setTracks([...timelineStore.tracks, track]);
		}
		const id = crypto.randomUUID();
		const item: TimelineItem = {
			id,
			trackId: track.id,
			from: safeFrom,
			durationInFrames,
			label: scene.text || media.fileName,
			type: 'video',
			mediaId: media.id,
			sourceStart: Math.round(scene.startSec * sourceFps),
			sourceEnd: Math.round(scene.endSec * sourceFps),
			sourceDuration: Math.max(1, Math.round(media.duration * sourceFps)),
			sourceFps
		};
		timelineStore._addItem(item);
		return id;
	});
}

export function insertSceneAtPlayhead(scene: MediaScene, media: MediaMetadata): string {
	return insertSceneAtFrame(scene, media, timelineStore.currentFrame);
}
