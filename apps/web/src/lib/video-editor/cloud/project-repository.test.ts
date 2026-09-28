import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
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
						thumbnail_url: '/media/media-1/thumbnail',
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
				remoteThumbnailUrl: '/media/media-1/thumbnail',
				contentHash: 'a'.repeat(64),
				duration: 2.5,
				width: 1920,
				height: 1080,
				fps: 29.97,
				codec: 'avc',
				audioCodec: 'aac',
				audioCodecSupported: true,
				bitrate: 3277
			})
		]);
	});

	it('deletes the server Project Asset that owns a cloud media source', async () => {
		const query = vi.spyOn(queryClient, 'query').mockResolvedValueOnce([
			{
				id: 'asset-1',
				project_id: 'project-1',
				workspace_id: 'workspace-1',
				media_id: 'media-1',
				stable_media_id: 'stable-media-1',
				original_filename: 'recording.webm',
				mime_type: 'video/webm',
				size: 1_024,
				sha256: '',
				status: 'ready',
				attention_reason: '',
				preparation: {},
				required: true,
				uploaded_by_user_id: 'user-1',
				device_id: 'device-1',
				created_at: '2026-09-20T00:00:00Z',
				updated_at: '2026-09-20T00:00:00Z'
			}
		]);
		// SAFETY: The mocked DELETE response only needs the generated client's success shape.
		const remove = vi.spyOn(client, 'DELETE').mockResolvedValue({
			data: undefined,
			error: undefined,
			response: new Response(null, { status: 200 })
		} as never);

		await new CloudVideoProjectRepository<object>('workspace-1').deleteAssetForMedia(
			'project-1',
			'stable-media-1'
		);

		expect(query).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledWith('/video-projects/{id}/assets/{asset_id}', {
			params: {
				path: { id: 'project-1', asset_id: 'asset-1' },
				query: { workspace_id: 'workspace-1' }
			}
		});
	});
});

it.each([
	{
		kind: 'audio',
		mime: 'audio/wav',
		codec: '',
		audioCodec: 'pcm-s16',
		duration: 4.285714,
		width: 0,
		height: 0,
		fps: 0
	},
	{
		kind: 'lottie',
		mime: 'application/zip',
		codec: 'lottie',
		audioCodec: undefined,
		duration: 2,
		width: 640,
		height: 360,
		fps: 30
	}
])('restores $kind probe metadata while server analysis is unavailable', async (fixture) => {
	vi.stubGlobal('location', { origin: 'https://openpost.test' });
	const query = vi.spyOn(queryClient, 'query');
	try {
		query.mockResolvedValueOnce([
			{
				status: 'ready',
				media_id: 'media',
				stable_media_id: 'stable',
				preparation: {
					editorMedia: {
						version: 1,
						...fixture,
						tags: [fixture.kind],
						lottieTotalFrames: fixture.kind === 'lottie' ? 60 : undefined
					}
				}
			}
		]);
		query.mockResolvedValueOnce({
			media: [
				{
					id: 'media',
					mime_type: fixture.mime,
					url: '/media/media',
					original_filename: 'source',
					size: 1024,
					duration_ms: 0,
					width: 0,
					height: 0,
					frame_rate: 0,
					bit_rate: 0
				}
			]
		});
		const [media] = await new CloudVideoProjectRepository<object>('workspace').listMedia('project');
		expect(media).toMatchObject({
			duration: fixture.duration,
			tags: [fixture.kind],
			codec: fixture.codec,
			width: fixture.width,
			height: fixture.height,
			fps: fixture.fps
		});
	} finally {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
});

it('restores each project asset even when its bytes are shared with another asset or the Media library', async () => {
	vi.stubGlobal('location', { origin: 'https://openpost.test' });
	const query = vi.spyOn(queryClient, 'query');
	try {
		query.mockResolvedValueOnce(
			['first', 'second'].map((id) => ({
				id,
				status: 'ready',
				media_id: 'shared-media',
				stable_media_id: id,
				original_filename: `${id}.mp4`,
				mime_type: 'video/mp4',
				size: 100,
				preparation: {}
			}))
		);
		query.mockResolvedValueOnce({
			media: [
				{
					id: 'shared-media',
					mime_type: 'video/mp4',
					url: '/media/shared-media',
					size: 100,
					duration_ms: 2000,
					width: 1920,
					height: 1080,
					frame_rate: 30,
					video_codec: 'h264'
				}
			]
		});
		const media = await new CloudVideoProjectRepository<object>('workspace').listMedia('project');
		expect(
			media.map((item) => ({ id: item.id, name: item.fileName, duration: item.duration }))
		).toEqual([
			{ id: 'first', name: 'first.mp4', duration: 2 },
			{ id: 'second', name: 'second.mp4', duration: 2 }
		]);
		expect(query.mock.calls[1]?.[0].queryKey).toContain('metadata');
	} finally {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
});
