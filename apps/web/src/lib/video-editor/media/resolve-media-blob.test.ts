import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMediaBlob } from './resolve-media-blob';
import type { MediaMetadata } from './types';

describe('resolveMediaBlob', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('fetches Cloud Project Asset bytes without a local workspace folder', async () => {
		const response = new Blob(['cloud video'], { type: 'video/mp4' });
		const fetchMock = vi.fn().mockResolvedValue(new Response(response));
		vi.stubGlobal('fetch', fetchMock);
		const media: MediaMetadata = {
			id: 'stable-media-1',
			storageType: 'cloud',
			remoteUrl: '/api/v1/media/server-media-1',
			fileName: 'launch.mp4',
			fileSize: response.size,
			mimeType: response.type,
			duration: 1,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'h264',
			bitrate: 88,
			tags: ['video']
		};

		await expect(resolveMediaBlob(media)).resolves.toEqual(response);
		expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/server-media-1', {
			credentials: 'include',
			signal: undefined
		});
	});

	it('aborts a cloud download without falling back to offline bytes', async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url, options: RequestInit) =>
					new Promise((_resolve, reject) => {
						options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
					})
			)
		);
		const cacheMatch = vi.fn();
		vi.stubGlobal('caches', { match: cacheMatch });
		const result = resolveMediaBlob(
			{
				id: 'recording',
				storageType: 'cloud',
				remoteUrl: '/recording.mp4',
				offlineUrl: '/offline.mp4',
				fileName: 'recording.mp4',
				fileSize: 100,
				mimeType: 'video/mp4',
				duration: 1,
				width: 1920,
				height: 1080,
				fps: 30,
				codec: 'h264',
				bitrate: 0,
				tags: []
			},
			{ signal: controller.signal }
		);
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(cacheMatch).not.toHaveBeenCalled();
	});

	it('uses an explicitly pinned original when the server is unreachable', async () => {
		const cached = new Blob(['offline video'], { type: 'video/mp4' });
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
		const cacheMatch = vi.fn().mockResolvedValue(new Response(cached));
		vi.stubGlobal('caches', { match: cacheMatch });

		await expect(
			resolveMediaBlob({
				id: 'stable-media-1',
				storageType: 'cloud',
				remoteUrl: '/api/v1/media/server-media-1',
				offlineUrl: 'https://openpost.test/__offline/media-1',
				fileName: 'launch.mp4',
				fileSize: cached.size,
				mimeType: cached.type,
				duration: 1,
				width: 1920,
				height: 1080,
				fps: 30,
				codec: 'h264',
				bitrate: 88,
				tags: ['video']
			})
		).resolves.toEqual(cached);
		expect(cacheMatch).toHaveBeenCalledWith('https://openpost.test/__offline/media-1');
	});
});
