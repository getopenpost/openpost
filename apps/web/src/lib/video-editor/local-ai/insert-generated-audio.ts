import type { MediaMetadata } from '../media/types';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { execute, executeAtomic } from '../timeline/commands/command-store.svelte';
import { linkItems } from '../timeline/actions/items';
import { insertMediaAtFrame } from '../timeline/actions/insert-media';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

/**
 * Add generated audio to a fresh audio track at the captured playhead. The track and clip
 * share one command so one undo removes both.
 */
function insertAudioOnNewTrack(
	media: MediaMetadata,
	playheadFrame: number,
	options: { commandType: string; trackName?: string }
): string {
	return execute(options.commandType, () => {
		const from = Number.isFinite(playheadFrame) ? Math.max(0, Math.round(playheadFrame)) : 0;
		const fps = timelineStore.fps;
		const sourceFps = media.fps > 0 ? media.fps : fps;
		const durationInFrames = Math.max(1, Math.round(media.duration * fps));
		const sourceDuration = Math.max(1, Math.round(media.duration * sourceFps));
		const audioTrackCount = timelineStore.tracks.filter((track) => track.kind === 'audio').length;
		const order =
			(timelineStore.tracks.length > 0
				? Math.max(...timelineStore.tracks.map((track) => track.order))
				: -1) + 1;
		const track: TimelineTrack = {
			id: crypto.randomUUID(),
			name: options.trackName ?? `Audio ${audioTrackCount + 1}`,
			kind: 'audio',
			height: 72,
			locked: false,
			syncLock: true,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order
		};
		const item: TimelineItem = {
			id: crypto.randomUUID(),
			trackId: track.id,
			from,
			durationInFrames,
			label: media.fileName,
			type: 'audio',
			mediaId: media.id,
			originId: crypto.randomUUID(),
			sourceStart: 0,
			sourceEnd: sourceDuration,
			sourceDuration,
			sourceFps,
			volume: 1
		};

		timelineStore._setTracks([...timelineStore.tracks, track]);
		timelineStore._addItem(item);
		return item.id;
	});
}

export function insertGeneratedAudioOnNewTrack(
	media: MediaMetadata,
	playheadFrame: number
): string {
	return insertAudioOnNewTrack(media, playheadFrame, { commandType: 'INSERT_GENERATED_AUDIO' });
}

export function insertVoiceoverOnNewTrack(
	media: MediaMetadata,
	playheadFrame: number,
	trackName: string
): string {
	return insertAudioOnNewTrack(media, playheadFrame, {
		commandType: 'INSERT_VOICEOVER',
		trackName
	});
}

/**
 * Insert generated speech at its source text item and link both items as one
 * edit. Reusing normal media placement keeps track collision and duration
 * rules aligned with every other audio import.
 */
export function insertGeneratedAudioForText(
	media: MediaMetadata,
	sourceTextItemId: string
): string {
	const source = timelineStore.itemById.get(sourceTextItemId);
	if (!source || source.type !== 'text') {
		throw new Error('The source text item is no longer available.');
	}

	return executeAtomic('INSERT_LINKED_TEXT_AUDIO', () => {
		const audioItemId = insertMediaAtFrame(media, source.from);
		if (!linkItems([sourceTextItemId, audioItemId])) {
			throw new Error('The generated audio could not be linked to its source text.');
		}
		return audioItemId;
	});
}
