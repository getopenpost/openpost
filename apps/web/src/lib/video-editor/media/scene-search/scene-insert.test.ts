import { beforeEach, expect, it } from 'vitest';
import { commandHistory } from '../../timeline/commands/command-store.svelte';
import { timelineStore } from '../../timeline/stores/timeline-store.svelte';
import type { MediaMetadata } from '../types';
import type { MediaScene } from './types';
import { insertSceneAtFrame } from './scene-insert';

const media = {
	id: 'source',
	storageType: 'workspace',
	fileName: 'source.mp4',
	fileSize: 10,
	mimeType: 'video/mp4',
	duration: 10,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'h264',
	bitrate: 0,
	tags: ['video']
} satisfies MediaMetadata;

const scene: MediaScene = {
	id: 'scene',
	mediaId: media.id,
	index: 0,
	startSec: 1,
	endSec: 2,
	timeSec: 1.5,
	text: 'Scene'
};

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.setAll({
		fps: 30,
		currentFrame: 0,
		tracks: [
			{
				id: 'video-1',
				name: 'Video',
				kind: 'video',
				height: 96,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			}
		],
		items: []
	});
});

it('reuses a track occupied only by a non-exclusive adjustment layer', () => {
	timelineStore._addItem({
		id: 'grade',
		trackId: 'video-1',
		from: 0,
		durationInFrames: 300,
		label: 'Grade',
		type: 'adjustment'
	});

	const id = insertSceneAtFrame(scene, media, 60);

	expect(timelineStore.itemById.get(id)?.trackId).toBe('video-1');
	expect(timelineStore.tracks).toHaveLength(1);
});

it('creates a visible track instead of inserting onto a hidden one', () => {
	timelineStore._setTracks(timelineStore.tracks.map((track) => ({ ...track, visible: false })));

	const id = insertSceneAtFrame(scene, media, 0);

	const inserted = timelineStore.itemById.get(id)!;
	expect(inserted.trackId).not.toBe('video-1');
	expect(timelineStore.tracks.find((track) => track.id === inserted.trackId)?.visible).toBe(true);
});
