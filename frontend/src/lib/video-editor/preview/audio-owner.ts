import type { TimelineItem } from '../project/types';
import type { TimelineTrack } from '../project/types';
import { hasLinkedAudioCompanion } from '../audio/transition-crossfade';
import type { MediaPoolEntry } from '../media/pool.svelte';

export type AudioOwner =
	| 'embedded'
	| 'processed'
	| 'linkedCompanion'
	| 'separateProxy'
	| 'unsupported'
	| 'muted'
	| 'none';

export interface AudioOwnerInput {
	item: TimelineItem;
	tracks: TimelineTrack[];
	allItems: TimelineItem[];
	mediaEntry?: MediaPoolEntry | null;
	usesSeparateProxyAudio: boolean;
	usesProcessedAudio: boolean;
}

export function resolveAudioOwner(input: AudioOwnerInput): AudioOwner {
	const { item, tracks, allItems, mediaEntry, usesSeparateProxyAudio, usesProcessedAudio } = input;
	if (item.type !== 'video' && item.type !== 'audio') return 'none';
	if (!mediaEntry || mediaEntry.status !== 'ready') return 'none';
	if (mediaEntry.media.audioCodecSupported === false) return 'unsupported';
	const track = tracks.find((t) => t.id === item.trackId);
	if (track?.muted) return 'muted';
	if (hasLinkedAudioCompanion(item, allItems)) return 'linkedCompanion';
	if (usesProcessedAudio) return 'processed';
	if (usesSeparateProxyAudio) return 'separateProxy';
	if (item.type === 'video' && item.mediaId) {
		const hasAudio = Boolean(mediaEntry.media?.audioCodec);
		if (hasAudio) return 'embedded';
		return 'none';
	}
	if (item.type === 'audio') return 'embedded';
	return 'none';
}
