import { describe, expect, it } from 'vitest';
import { createCloudBundleRuntime } from './export-project-bundle';

describe('cloud Video Project bundle export', () => {
	it('exports the portable document and every required original', async () => {
		const repository = {
			get: async () => ({
				document: {
					id: 'project-1',
					name: 'Launch',
					timeline: { items: [{ id: 'clip-1', mediaId: 'media-1' }] }
				}
			}),
			listMedia: async () => [
				{
					id: 'media-1',
					storageType: 'cloud' as const,
					remoteUrl: '/api/v1/media/media-1/content',
					contentHash: 'abc',
					fileName: 'launch.mp4',
					fileSize: 7,
					mimeType: 'video/mp4',
					duration: 2,
					width: 1920,
					height: 1080,
					fps: 30,
					codec: 'h264',
					bitrate: 1000,
					tags: ['video']
				}
			]
		};
		const runtime = createCloudBundleRuntime(repository);

		const snapshot = await runtime.exportSnapshot('project-1');
		expect(snapshot.project).toEqual(expect.objectContaining({ id: 'project-1', name: 'Launch' }));
		expect(snapshot.mediaReferences).toEqual([
			expect.objectContaining({ id: 'media-1', fileName: 'launch.mp4', contentHash: 'abc' })
		]);
		expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/);
		expect(await runtime.getProjectMediaIds('project-1')).toEqual(['media-1']);
		expect(await runtime.getMedia('media-1')).toEqual(
			expect.objectContaining({ remoteUrl: '/api/v1/media/media-1/content' })
		);
	});
});
