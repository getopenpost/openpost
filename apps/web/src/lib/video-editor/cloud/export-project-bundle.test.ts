import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { createCloudBundleRuntime } from './export-project-bundle';

describe('cloud Video Project bundle export', () => {
	it('exports the portable document and every required original', async () => {
		const project = createBlankProject('Launch');
		project.id = 'project-1';
		project.timeline!.items = [
			{
				id: 'clip-1',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 60,
				label: 'Clip',
				type: 'video',
				mediaId: 'media-1'
			}
		];
		const repository = {
			get: async () => ({ document: project }),
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
