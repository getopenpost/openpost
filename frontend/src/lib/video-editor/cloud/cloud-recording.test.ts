import { describe, expect, it, vi } from 'vitest';
import type { CaptureArtifact } from '../recorder/recorder.svelte';
import { saveRecorderArtifactsToCloud } from './cloud-recording';

function artifact(kind: CaptureArtifact['kind'], offset: number): CaptureArtifact {
	return {
		kind,
		blob: new Blob([kind], {
			type: kind === 'microphone' ? 'audio/webm' : 'video/webm'
		}),
		mimeType: kind === 'microphone' ? 'audio/webm' : 'video/webm',
		durationMs: 2_000,
		startOffsetMs: offset,
		sizeBytes: kind.length,
		scratchId: `${kind}-scratch`
	};
}

describe('cloud recorder projects', () => {
	it('creates one authored project and uploads every recording as a required asset', async () => {
		const createWithId = vi.fn().mockImplementation(async (id, name, document) => ({
			id,
			name,
			document
		}));
		const reserveAsset = vi
			.fn()
			.mockResolvedValueOnce('screen-reservation')
			.mockResolvedValueOnce('mic-reservation');
		const repository = {
			workspaceId: 'workspace-1',
			createWithId,
			reserveAsset
		};
		const upload = vi.fn().mockResolvedValue(undefined);

		const result = await saveRecorderArtifactsToCloud(
			repository,
			[artifact('screen', 0), artifact('microphone', 250)],
			{
				now: () => new Date('2026-09-06T10:00:00Z'),
				id: vi
					.fn()
					.mockReturnValueOnce('project-1')
					.mockReturnValueOnce('screen-1')
					.mockReturnValueOnce('mic-1'),
				hash: vi.fn().mockResolvedValue('a'.repeat(64)),
				probe: vi.fn().mockResolvedValue({ duration: 2, width: 1920, height: 1080 }),
				upload
			}
		);

		expect(createWithId).toHaveBeenCalledWith(
			'project-1',
			'Recording 2026-09-06 10:00',
			expect.objectContaining({
				timeline: {
					tracks: expect.arrayContaining([
						expect.objectContaining({ kind: 'video' }),
						expect.objectContaining({ kind: 'audio' })
					]),
					items: expect.arrayContaining([
						expect.objectContaining({ mediaId: 'screen-1', from: 0 }),
						expect.objectContaining({ mediaId: 'mic-1', from: 8 })
					]),
					transitions: []
				}
			})
		);
		expect(reserveAsset).toHaveBeenCalledTimes(2);
		expect(upload).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			projectId: 'project-1',
			name: 'Recording 2026-09-06 10:00'
		});
	});
});
