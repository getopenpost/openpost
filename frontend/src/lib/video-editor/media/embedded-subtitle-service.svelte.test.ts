import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { insertEmbeddedSubtitleTrack } from './embedded-subtitle-service';
import type { EmbeddedSubtitleTrack } from './embedded-subtitles';
import type { MediaMetadata } from './types';

const media: MediaMetadata = {
	id: 'media',
	storageType: 'workspace',
	fileName: 'interview.mkv',
	fileSize: 10,
	mimeType: 'video/x-matroska',
	duration: 5,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'h264',
	bitrate: 1,
	tags: ['video']
};

const subtitleTrack: EmbeddedSubtitleTrack = {
	trackNumber: 3,
	codecId: 'S_TEXT/UTF8',
	language: 'eng',
	name: 'English',
	default: true,
	forced: false,
	cues: [
		{ id: 'cue-a', startSeconds: 0.5, endSeconds: 1.5, text: 'Clipped start' },
		{ id: 'cue-b', startSeconds: 2, endSeconds: 4, text: 'Kept cue' }
	]
};

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const audioTrack: TimelineTrack = {
	...videoTrack,
	id: 'audio-track',
	name: 'Audio',
	kind: 'audio',
	order: 1
};

const items: TimelineItem[] = [
	{
		id: 'video',
		trackId: videoTrack.id,
		from: 100,
		durationInFrames: 60,
		label: 'Interview video',
		type: 'video',
		mediaId: media.id,
		linkedGroupId: 'av-pair',
		sourceStart: 30,
		sourceEnd: 150,
		sourceFps: 30,
		speed: 2
	},
	{
		id: 'audio',
		trackId: audioTrack.id,
		from: 100,
		durationInFrames: 60,
		label: 'Interview audio',
		type: 'audio',
		mediaId: media.id,
		linkedGroupId: 'av-pair',
		sourceStart: 30,
		sourceEnd: 150,
		sourceFps: 30,
		speed: 2
	},
	{
		id: 'stale',
		trackId: videoTrack.id,
		from: 100,
		durationInFrames: 20,
		label: 'Old subtitles',
		type: 'subtitle',
		captionSource: {
			type: 'embedded-subtitles',
			clipId: 'audio',
			mediaId: media.id,
			trackNumber: 1,
			language: 'eng',
			codecId: 'S_TEXT/UTF8'
		},
		cues: [{ id: 'old', startFrame: 100, endFrame: 120, text: 'Old' }]
	}
];

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [videoTrack, audioTrack], items, fps: 30, currentFrame: 0 });
});

afterEach(() => setLocale('en', { reload: false }));

describe('insertEmbeddedSubtitleTrack', () => {
	it('maps one source track onto linked clips once, replaces stale cues, and undoes atomically', () => {
		setLocale('pt', { reload: false });
		const result = insertEmbeddedSubtitleTrack(media, subtitleTrack, {
			canvasWidth: 1920,
			canvasHeight: 1080
		});

		expect(result.cueCount).toBe(2);
		expect(result.itemIds).toHaveLength(1);
		expect(timelineStore.itemById.has('stale')).toBe(false);
		const subtitle = timelineStore.itemById.get(result.itemIds[0]!);
		expect(subtitle).toMatchObject({
			type: 'subtitle',
			from: 100,
			durationInFrames: 45,
			linkedGroupId: 'av-pair',
			captionSource: {
				type: 'embedded-subtitles',
				clipId: 'video',
				trackNumber: 3,
				language: 'eng'
			},
			cues: [
				{ id: 'cue-a', startFrame: 100, endFrame: 108, text: 'Clipped start' },
				{ id: 'cue-b', startFrame: 115, endFrame: 145, text: 'Kept cue' }
			]
		});
		expect(timelineStore.tracks.find((track) => track.id === subtitle?.trackId)?.name).toBe(
			'Legendas'
		);
		expect(commandHistory.undoStack).toHaveLength(1);

		commandHistory.undo();
		expect(timelineStore.itemById.has('stale')).toBe(true);
		expect(timelineStore.tracks).toEqual([videoTrack, audioTrack]);
	});

	it('preserves embedded captions beneath a locked track group', () => {
		const group: TimelineTrack = {
			id: 'locked-group',
			name: 'Locked captions',
			height: 96,
			locked: true,
			visible: true,
			muted: false,
			solo: false,
			order: -1,
			isGroup: true
		};
		timelineStore.setAll({
			tracks: [group, { ...videoTrack, parentTrackId: group.id }, audioTrack],
			items,
			fps: 30,
			currentFrame: 0
		});

		expect(() =>
			insertEmbeddedSubtitleTrack(media, subtitleTrack, {
				canvasWidth: 1920,
				canvasHeight: 1080
			})
		).toThrow('Unlock the existing caption track before retranscribing this clip.');
		expect(timelineStore.itemById.get('stale')).toEqual(items[2]);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
