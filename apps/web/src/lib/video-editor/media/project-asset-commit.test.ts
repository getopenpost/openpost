import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitGeneratedAudio } from '../local-ai/commit-generated-audio';
import { mediaPool } from './pool.svelte';
import { commitImportedAsset } from './commit-imported-asset';
import {
	importGeneratedImage,
	importGeneratedVideo,
	importRecordedAudio,
	importRemoteLottie
} from './import.svelte';
import type { MediaMetadata } from './types';

function cloudMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
	return {
		id: 'cloud-media-1',
		storageType: 'cloud',
		remoteUrl: '/media/cloud-media-1',
		fileName: 'asset.png',
		fileSize: 5,
		mimeType: 'image/png',
		duration: 0,
		width: 1,
		height: 1,
		fps: 0,
		codec: '',
		bitrate: 0,
		tags: ['image'],
		...overrides
	};
}

describe('project asset commits', () => {
	beforeEach(() => mediaPool.clear());
	afterEach(() => vi.unstubAllGlobals());

	it('uses the supplied Cloud importer for stock and sticker assets', async () => {
		const media = cloudMedia();
		const importAsset = vi.fn(async () => {
			mediaPool.upsert(media, 'ready');
			return media;
		});
		const file = new File(['asset'], 'asset.png', { type: 'image/png' });

		const committed = await commitImportedAsset(
			file,
			{
				projectId: 'cloud-project-1',
				attribution: { provider: 'Pexels', license: 'Pexels License' },
				tags: ['stock', 'pexels'],
				insertAtFrame: 24,
				importAsset
			},
			{ insertMedia: vi.fn(() => 'timeline-item-1') }
		);

		expect(committed.media).toBe(media);
		expect(importAsset).toHaveBeenCalledWith(
			file,
			expect.objectContaining({
				projectId: 'cloud-project-1',
				tags: ['stock', 'pexels']
			})
		);
	});

	it('uses the supplied Cloud importer when adding generated audio at the playhead', async () => {
		const media = cloudMedia({
			fileName: 'voice.wav',
			mimeType: 'audio/wav',
			duration: 1.25,
			tags: ['audio']
		});
		const importAsset = vi.fn(async () => {
			mediaPool.upsert(media, 'ready');
			return media;
		});
		const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' });

		const committed = await commitGeneratedAudio(
			{ blob: file, file, duration: 1.25, sampleRate: 24_000 },
			{
				projectId: 'cloud-project-1',
				tags: ['local-ai', 'supertonic'],
				insertAtFrame: 12,
				importAsset
			},
			{
				insertForText: vi.fn(() => 'linked-audio-item-1'),
				insertOnTrack: vi.fn(() => 'audio-item-1')
			}
		);

		expect(committed.media).toBe(media);
		expect(importAsset).toHaveBeenCalledWith(
			file,
			expect.objectContaining({ duration: 1.25, projectId: 'cloud-project-1' })
		);
	});

	it('uses the supplied Cloud importer when saving generated audio to the media pool', async () => {
		const media = cloudMedia({
			fileName: 'voice.wav',
			mimeType: 'audio/wav',
			duration: 1.25,
			tags: ['audio']
		});
		const importAsset = vi.fn(async () => {
			mediaPool.upsert(media, 'ready');
			return media;
		});
		const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' });

		const committed = await commitGeneratedAudio(
			{ blob: file, file, duration: 1.25, sampleRate: 24_000 },
			{
				projectId: 'cloud-project-1',
				tags: ['local-ai', 'moss'],
				importAsset
			},
			{
				insertForText: vi.fn(() => 'linked-audio-item-1'),
				insertOnTrack: vi.fn(() => 'audio-item-1')
			}
		);

		expect(committed).toEqual({ media, itemId: undefined });
		expect(importAsset).toHaveBeenCalledOnce();
	});

	it('removes newly imported Cloud audio from the active pool when timeline insertion fails', async () => {
		const media = cloudMedia({
			fileName: 'voice.wav',
			mimeType: 'audio/wav',
			duration: 1.25,
			tags: ['audio']
		});
		const importAsset = vi.fn(async () => {
			mediaPool.upsert(media, 'ready');
			return media;
		});
		const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' });

		await expect(
			commitGeneratedAudio(
				{ blob: file, file, duration: 1.25, sampleRate: 24_000 },
				{
					projectId: 'cloud-project-1',
					tags: ['local-ai', 'supertonic'],
					insertAtFrame: 12,
					importAsset
				},
				{
					insertForText: vi.fn(() => 'linked-audio-item-1'),
					insertOnTrack: vi.fn(() => {
						throw new Error('No compatible timeline track is available.');
					})
				}
			)
		).rejects.toThrow('No compatible timeline track is available.');
		expect(mediaPool.get(media.id)).toBeUndefined();
	});

	it('routes downloaded LottieFiles animations through the supplied project importer', async () => {
		const media = cloudMedia({
			fileName: 'rocket.lottie',
			mimeType: 'application/zip',
			tags: ['lottie']
		});
		const importAsset = vi.fn(async () => media);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Blob(['animation'], { type: 'application/zip' })))
		);

		const mediaId = await importRemoteLottie({
			projectId: 'cloud-project-1',
			url: 'https://assets-v2.lottiefiles.com/rocket.lottie',
			fileName: 'Rocket',
			attribution: { provider: 'LottieFiles', license: 'Lottie Simple License' },
			importAsset
		});

		expect(mediaId).toBe(media.id);
		expect(importAsset).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Rocket.lottie', type: 'application/zip' }),
			expect.objectContaining({
				projectId: 'cloud-project-1',
				tags: ['lottie']
			})
		);
	});

	it('routes generated images and videos through the supplied project importer', async () => {
		const image = cloudMedia({ fileName: 'frame.png', mimeType: 'image/png', tags: ['image'] });
		const video = cloudMedia({
			id: 'cloud-video-1',
			fileName: 'upscaled.mp4',
			mimeType: 'video/mp4',
			tags: ['video']
		});
		const importAsset = vi.fn(async (file: File) =>
			file.type.startsWith('image/') ? image : video
		);

		await expect(
			importGeneratedImage(new File(['image'], 'frame.png', { type: 'image/png' }), {
				projectId: 'cloud-project-1',
				tags: ['frame-capture'],
				importAsset
			})
		).resolves.toBe(image);
		await expect(
			importGeneratedVideo(new File(['video'], 'upscaled.mp4', { type: 'video/mp4' }), {
				projectId: 'cloud-project-1',
				tags: ['upscaled'],
				importAsset
			})
		).resolves.toBe(video);
		expect(importAsset).toHaveBeenCalledTimes(2);
	});

	it('routes recorded voiceover audio through the supplied project importer', async () => {
		const audio = cloudMedia({
			fileName: 'voiceover.wav',
			mimeType: 'audio/wav',
			duration: 2.5,
			tags: ['audio', 'recorded', 'voiceover']
		});
		const importAsset = vi.fn(async () => audio);
		const file = new File(['audio'], 'voiceover.wav', { type: 'audio/wav' });

		await expect(
			importRecordedAudio(file, {
				projectId: 'cloud-project-1',
				duration: 2.5,
				tags: ['voiceover'],
				importAsset
			})
		).resolves.toBe(audio);
		expect(importAsset).toHaveBeenCalledWith(
			file,
			expect.objectContaining({
				projectId: 'cloud-project-1',
				duration: 2.5,
				tags: ['audio', 'recorded', 'voiceover']
			})
		);
	});
});
