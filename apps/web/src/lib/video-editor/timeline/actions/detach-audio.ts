import { mediaPool } from '../../media/pool.svelte';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks, isTrackEffectivelyLocked } from '../utils/track-groups';
import { snapshotTimelineState } from '../utils/state-snapshot.svelte';
import { hasLinkedAudioCompanion } from '../../audio/transition-crossfade';

const SHARED_AUDIO_FIELDS = new Set([
	'mediaId',
	'from',
	'durationInFrames',
	'sourceStart',
	'sourceEnd',
	'sourceDuration',
	'sourceFps',
	'speed',
	'speedRamp',
	'isReversed',
	'volume'
]);

export function canDetachAudio(item: TimelineItem): boolean {
	if (item.type !== 'video' || !item.mediaId || item.audioDetached) return false;
	if (isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) return false;
	if (hasLinkedAudioCompanion(item, timelineStore.items)) return false;
	const media = mediaPool.get(item.mediaId);
	return Boolean(media?.hasAudio || media?.audioCodec);
}

/** Separate the source without changing its sound or making edit links own audio playback. */
export function detachAudio(itemId: string): string | null {
	const item = timelineStore.itemById.get(itemId);
	if (!item || !canDetachAudio(item)) return null;
	const sourceTrack = effectiveMediaTracks(timelineStore.tracks).find(
		(track) => track.id === item.trackId
	);
	if (!sourceTrack) return null;
	return execute('DETACH_AUDIO', () => {
		const linkedGroupId = item.linkedGroupId ?? crypto.randomUUID();
		const originId = item.originId ?? item.id;
		const track: TimelineTrack = {
			id: crypto.randomUUID(),
			name: item.label,
			kind: 'audio',
			height: 72,
			order: Math.max(-1, ...timelineStore.tracks.map((track) => track.order)) + 1,
			locked: false,
			syncLock: sourceTrack.syncLock,
			visible: sourceTrack.visible,
			muted: sourceTrack.muted,
			solo: sourceTrack.solo,
			volume: sourceTrack.volume,
			audioEq: snapshotTimelineState(sourceTrack.audioEq)
		};
		const source = snapshotTimelineState(item);
		const audioFields = Object.fromEntries(
			Object.entries(source).filter(
				([key]) =>
					SHARED_AUDIO_FIELDS.has(key) || (key.startsWith('audio') && key !== 'audioDetached')
			)
		);
		const audio: TimelineItem = {
			...audioFields,
			id: crypto.randomUUID(),
			type: 'audio',
			label: item.label,
			trackId: track.id,
			from: item.from,
			durationInFrames: item.durationInFrames,
			originId,
			linkedGroupId,
			keyframes: source.keyframes?.volume ? { volume: source.keyframes.volume } : undefined
		};
		timelineStore._setTracks([...timelineStore.tracks, track]);
		timelineStore._setItems(
			[
				...timelineStore.items.map((candidate) =>
					candidate.id === itemId
						? { ...candidate, originId, linkedGroupId, audioDetached: true }
						: candidate
				),
				audio
			].map((candidate) => {
				if (!candidate.audioDucking?.targetTrackIds?.includes(item.trackId)) return candidate;
				return {
					...candidate,
					audioDucking: {
						...candidate.audioDucking,
						targetTrackIds: [...candidate.audioDucking.targetTrackIds, track.id]
					}
				};
			})
		);
		return audio.id;
	});
}
