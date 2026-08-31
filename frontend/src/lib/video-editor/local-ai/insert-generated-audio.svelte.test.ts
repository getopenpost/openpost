import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaMetadata } from '../media/types';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	insertGeneratedAudioForText,
	insertGeneratedAudioOnNewTrack,
	insertVoiceoverOnNewTrack
} from './insert-generated-audio';

const media: MediaMetadata = {
	id: 'generated-media',
	storageType: 'workspace',
	fileName: 'voice.wav',
	fileSize: 1024,
	mimeType: 'audio/wav',
	duration: 2,
	width: 0,
	height: 0,
	fps: 0,
	codec: '',
	bitrate: 4096,
	tags: ['audio', 'ai-generated']
};

function track(id: string, kind: 'video' | 'audio', order: number): TimelineTrack {
	return {
		id,
		name: kind === 'audio' ? 'Audio 1' : 'Video 1',
		kind,
		height: 72,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order
	};
}

describe('insertGeneratedAudioOnNewTrack', () => {
	beforeEach(() => {
		commandHistory.clearHistory();
		timelineStore.clear();
		timelineStore.setAll({
			fps: 30,
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)]
		});
	});

	it('keeps existing audio intact and inserts at the captured playhead', () => {
		const existing: TimelineItem = {
			id: 'existing',
			trackId: 'audio-track',
			from: 60,
			durationInFrames: 90,
			label: 'existing.wav',
			type: 'audio',
			mediaId: 'existing-media'
		};
		timelineStore._setItems([existing]);

		const id = insertGeneratedAudioOnNewTrack(media, 87);
		const inserted = timelineStore.itemById.get(id);
		const newTrack = timelineStore.tracks.find((candidate) => candidate.id === inserted?.trackId);

		expect(inserted).toMatchObject({
			from: 87,
			durationInFrames: 60,
			mediaId: media.id,
			sourceEnd: 60,
			sourceDuration: 60,
			sourceFps: 30
		});
		expect(newTrack).toMatchObject({ kind: 'audio', name: 'Audio 2', order: 2 });
		expect(timelineStore.itemById.get(existing.id)).toEqual(existing);
	});

	it('undoes the generated clip and its track together', () => {
		insertGeneratedAudioOnNewTrack(media, 42);

		commandHistory.undo();

		expect(timelineStore.items).toEqual([]);
		expect(timelineStore.tracks.map((candidate) => candidate.id)).toEqual([
			'video-track',
			'audio-track'
		]);
	});

	it('inserts a named voiceover take as one undoable action', () => {
		const id = insertVoiceoverOnNewTrack(
			{ ...media, id: 'voiceover-media', fileName: 'voiceover.webm', duration: 3.25 },
			-12,
			'Voiceover'
		);
		const inserted = timelineStore.itemById.get(id);

		expect(inserted).toMatchObject({
			from: 0,
			durationInFrames: 98,
			label: 'voiceover.webm',
			mediaId: 'voiceover-media',
			type: 'audio'
		});
		expect(timelineStore.tracks.find((track) => track.id === inserted?.trackId)).toMatchObject({
			name: 'Voiceover',
			kind: 'audio',
			order: 2
		});
		expect(commandHistory.getLastCommandType()).toBe('INSERT_VOICEOVER');

		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
		expect(timelineStore.tracks).toHaveLength(2);
	});
});

describe('insertGeneratedAudioForText', () => {
	beforeEach(() => {
		commandHistory.clearHistory();
		timelineStore.clear();
		timelineStore.setAll({
			fps: 30,
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
			items: [
				{
					id: 'text-item',
					trackId: 'video-track',
					from: 75,
					durationInFrames: 120,
					label: 'Launch text',
					type: 'text',
					text: 'Launch today'
				},
				{
					id: 'occupied-audio',
					trackId: 'audio-track',
					from: 60,
					durationInFrames: 90,
					label: 'Existing narration',
					type: 'audio',
					mediaId: 'existing-media'
				}
			]
		});
	});

	it('aligns and links speech to its text as one complete undo step', () => {
		const id = insertGeneratedAudioForText(media, 'text-item');
		const source = timelineStore.itemById.get('text-item');
		const inserted = timelineStore.itemById.get(id);

		expect(inserted).toMatchObject({
			from: 75,
			durationInFrames: 60,
			type: 'audio',
			mediaId: media.id
		});
		expect(inserted?.trackId).not.toBe('audio-track');
		expect(source?.linkedGroupId).toBeTruthy();
		expect(inserted?.linkedGroupId).toBe(source?.linkedGroupId);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('INSERT_LINKED_TEXT_AUDIO');

		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
		expect(timelineStore.itemById.get('text-item')?.linkedGroupId).toBeUndefined();
		expect(timelineStore.tracks.map((candidate) => candidate.id)).toEqual([
			'video-track',
			'audio-track'
		]);
	});

	it('rejects a stale or non-text source without changing the project', () => {
		expect(() => insertGeneratedAudioForText(media, 'missing')).toThrow(
			'The source text item is no longer available.'
		);
		expect(commandHistory.canUndo).toBe(false);
		expect(timelineStore.items).toHaveLength(2);
	});
});
