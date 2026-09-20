import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '$lib/query/client';
import { CloudVideoProjectRepository } from './project-repository';

describe('CloudVideoProjectRepository media reload', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('restores the project asset hash and supported server probe metadata', async () => {
		vi.stubGlobal('location', { origin: 'https://openpost.test' });
		const query = vi.spyOn(queryClient, 'query');
		query
			.mockResolvedValueOnce([
				{
					id: 'asset-1',
					project_id: 'project-1',
					workspace_id: 'workspace-1',
					media_id: 'media-1',
					stable_media_id: 'stable-media-1',
					original_filename: 'source.mp4',
					mime_type: 'video/mp4',
					size: 1_024,
					sha256: 'a'.repeat(64),
					status: 'ready',
					attention_reason: '',
					preparation: {},
					required: true,
					uploaded_by_user_id: 'user-1',
					device_id: 'device-1',
					created_at: '2026-09-20T00:00:00Z',
					updated_at: '2026-09-20T00:00:00Z'
				}
			])
			.mockResolvedValueOnce({
				media: [
					{
						id: 'media-1',
						workspace_id: 'workspace-1',
						mime_type: 'video/mp4',
						size: 1_024,
						original_filename: 'source.mp4',
						width: 1920,
						height: 1080,
						url: '/media/media-1',
						duration_ms: 2_500,
						frame_rate: 29.97,
						container_format: 'mp4',
						video_codec: 'avc',
						audio_codec: 'aac',
						bit_rate: 4_000_000
					}
				],
				total: 1
			});

		const repository = new CloudVideoProjectRepository<object>('workspace-1');

		await expect(repository.listMedia('project-1')).resolves.toEqual([
			expect.objectContaining({
				id: 'stable-media-1',
				contentHash: 'a'.repeat(64),
				duration: 2.5,
				width: 1920,
				height: 1080,
				fps: 29.97,
				codec: 'avc',
				audioCodec: 'aac',
				bitrate: 4_000_000
			})
		]);
	});
});
