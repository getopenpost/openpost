import { client } from '$lib/api/client';
import { mediaQueryKeys, type MediaStorage } from '@openpost/query-catalog';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from './client';
import { createMediaQueryAPI, queryMediaStorage } from './media';

describe('Media web Query helpers', () => {
	beforeEach(() => {
		queryClient.clear();
	});

	it('shares the cached workspace storage capability with upload callers', async () => {
		const storage: MediaStorage = {
			asset_count: 3,
			direct_upload_supported: false,
			internal_bytes: 0,
			limit_bytes: 1024,
			used_bytes: 512
		};
		queryClient.setQueryData(mediaQueryKeys.storage('workspace-1'), storage);

		await expect(queryMediaStorage('workspace-1')).resolves.toEqual(storage);
	});

	it('rejects an upload caller that is already cancelled even when storage is cached', async () => {
		queryClient.setQueryData(mediaQueryKeys.storage('workspace-1'), {
			asset_count: 0,
			direct_upload_supported: true,
			internal_bytes: 0,
			limit_bytes: 0,
			used_bytes: 0
		} satisfies MediaStorage);
		const controller = new AbortController();
		controller.abort();

		await expect(queryMediaStorage('workspace-1', controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
	});
});

it('keeps playback URLs and probe metadata when loading exact media IDs', async () => {
	const fixture = {
		id: 'media',
		mime_type: 'video/mp4',
		url: '/media/media',
		thumbnail_url: '/media/media/thumbnail',
		size: 1024,
		width: 1920,
		height: 1080,
		duration_ms: 8000,
		frame_rate: 30,
		container_format: 'mp4',
		video_codec: 'h264',
		audio_codec: 'aac'
	};
	const api = createMediaQueryAPI(client, async () => Response.json({ media: [fixture] }));
	const result = await api.getMediaMetadata('workspace', ['media'], new AbortController().signal);
	expect(result.media).toEqual([fixture]);
});
