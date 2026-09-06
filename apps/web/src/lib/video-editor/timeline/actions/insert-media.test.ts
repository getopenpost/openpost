import { beforeEach, describe, expect, it } from 'vitest';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import type { MediaMetadata } from '../../media/types';
import { insertMediaAtFrame } from './insert-media';

const image = {
	id: 'sticker',
	storageType: 'workspace',
	fileName: 'party-popper.png',
	fileSize: 10,
	mimeType: 'image/png',
	duration: 0,
	width: 1024,
	height: 1024,
	fps: 0,
	codec: 'png',
	bitrate: 0,
	tags: ['image', 'sticker']
} satisfies MediaMetadata;

describe('insertMediaAtFrame', () => {
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

	it('fits an image and inserts it at the requested frame', () => {
		const id = insertMediaAtFrame(image, 42, { label: 'Party Popper' });
		expect(timelineStore.itemById.get(id)).toMatchObject({
			trackId: 'video-1',
			from: 42,
			durationInFrames: 90,
			label: 'Party Popper',
			type: 'image',
			mediaId: 'sticker',
			transform: { width: 346, height: 346 }
		});
		expect(commandHistory.getLastCommandType()).toBe('INSERT_MEDIA_AT_FRAME');
	});

	it('creates an overlay track when the playhead range is occupied and undoes atomically', () => {
		timelineStore._addItem({
			id: 'existing',
			trackId: 'video-1',
			from: 0,
			durationInFrames: 300,
			label: 'Background',
			type: 'image',
			mediaId: 'background'
		});
		const id = insertMediaAtFrame(image, 60);
		const inserted = timelineStore.itemById.get(id)!;
		expect(inserted.trackId).not.toBe('video-1');
		expect(timelineStore.tracks).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
		expect(timelineStore.tracks.map((track) => track.id)).toEqual(['video-1']);
	});

	it('uses an open preferred track before adding another track', () => {
		timelineStore._setTracks([
			...timelineStore.tracks,
			{
				id: 'video-2',
				name: 'Overlay',
				kind: 'video',
				height: 96,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: -1
			}
		]);
		const id = insertMediaAtFrame(image, 0, { preferredTrackId: 'video-1' });
		expect(timelineStore.itemById.get(id)?.trackId).toBe('video-1');
		expect(timelineStore.tracks).toHaveLength(2);
	});

	it('rejects an occupied exact track without adding an item, track, or undo entry', () => {
		timelineStore._addItem({
			id: 'existing',
			trackId: 'video-1',
			from: 0,
			durationInFrames: 300,
			label: 'Background',
			type: 'image',
			mediaId: 'background'
		});
		commandHistory.clearHistory();

		expect(() => insertMediaAtFrame(image, 60, { exactTrackId: 'video-1' })).toThrow('collision');
		expect(timelineStore.items.map((item) => item.id)).toEqual(['existing']);
		expect(timelineStore.tracks.map((track) => track.id)).toEqual(['video-1']);
		expect(commandHistory.canUndo).toBe(false);
	});
});
