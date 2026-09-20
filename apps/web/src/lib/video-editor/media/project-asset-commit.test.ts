import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitGeneratedAudio } from '../local-ai/commit-generated-audio';
import { mediaPool } from './pool.svelte';
import { commitImportedAsset } from './commit-imported-asset';
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
});
