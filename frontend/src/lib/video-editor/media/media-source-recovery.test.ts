import { describe, expect, it } from 'vitest';
import {
	createMediaSourceRecovery,
	type MediaSourceRecoveryRuntime
} from './media-source-recovery';
import type { MediaMetadata } from './types';

function media(storageType: 'handle' | 'workspace' = 'handle'): MediaMetadata {
	return {
		id: 'media',
		storageType,
		fileName: 'old.mp4',
		fileSize: 50,
		mimeType: 'video/mp4',
		duration: 2,
		width: 640,
		height: 360,
		fps: 30,
		codec: 'avc',
		bitrate: 1_000,
		tags: ['video', 'favorite']
	};
}

function runtime() {
	const writtenSources: Array<{ mediaId: string; file: File }> = [];
	const writtenThumbnails: Array<{ mediaId: string; thumbnail: Blob }> = [];
	const updates: Array<{ mediaId: string; updates: Partial<MediaMetadata> }> = [];
	const removedSources: Array<{ mediaId: string; fileName: string }> = [];
	const invalidated: string[] = [];
	const published: MediaMetadata[] = [];
	const calls = {
		writtenSources,
		writtenThumbnails,
		updates,
		removedSources,
		invalidated,
		published
	};
	let handleValidation: Awaited<ReturnType<MediaSourceRecoveryRuntime['validateHandle']>> = {
		kind: 'ok'
	};
	let workspaceSource: Blob | null = new Blob(['source']);
	let replacementKind: 'video' | 'audio' = 'video';
	const recoveryRuntime: MediaSourceRecoveryRuntime = {
		validateHandle: async () => handleValidation,
		readWorkspaceSource: async () => workspaceSource,
		prepareFile: async (file) => file,
		probeFile: async () => ({
			kind: replacementKind,
			duration: 4,
			width: replacementKind === 'video' ? 1920 : 0,
			height: replacementKind === 'video' ? 1080 : 0,
			fps: replacementKind === 'video' ? 24 : 0,
			frameRateMetrics:
				replacementKind === 'video'
					? {
							underlyingFrameRate: null,
							bestGuessFrameRate: 24,
							minFrameRate: 23.976,
							maxFrameRate: 30,
							averageFrameRate: 24.5,
							medianFrameRate: 24,
							frameRateIsConstant: false,
							probedPacketCount: 256
						}
					: undefined,
			codec: replacementKind === 'video' ? 'avc1' : '',
			audioCodec: replacementKind === 'video' ? 'aac' : 'pcm',
			thumbnailBlob:
				replacementKind === 'video' ? new Blob(['thumb'], { type: 'image/jpeg' }) : undefined
		}),
		writeWorkspaceSource: async (mediaId, file) => {
			calls.writtenSources.push({ mediaId, file });
		},
		writeThumbnail: async (mediaId, thumbnail) => {
			calls.writtenThumbnails.push({ mediaId, thumbnail });
		},
		update: async (mediaId, updates) => {
			calls.updates.push({ mediaId, updates });
			return { ...media(), ...updates, id: mediaId };
		},
		removeWorkspaceSource: async (mediaId, fileName) => {
			calls.removedSources.push({ mediaId, fileName });
		},
		invalidate: async (mediaId) => {
			calls.invalidated.push(mediaId);
		},
		publish: (restored) => calls.published.push(restored)
	};
	return {
		calls,
		recovery: createMediaSourceRecovery(recoveryRuntime),
		setHandleValidation(value: typeof handleValidation) {
			handleValidation = value;
		},
		setWorkspaceSource(value: Blob | null) {
			workspaceSource = value;
		},
		setReplacementKind(value: typeof replacementKind) {
			replacementKind = value;
		}
	};
}

describe('media source recovery', () => {
	it('distinguishes expired handle access from a missing workspace copy', async () => {
		const testRuntime = runtime();
		testRuntime.setHandleValidation({ kind: 'permission' });
		await expect(testRuntime.recovery.validateMediaSource(media('handle'))).resolves.toEqual({
			mediaId: 'media',
			fileName: 'old.mp4',
			kind: 'permission'
		});

		testRuntime.setWorkspaceSource(null);
		await expect(testRuntime.recovery.validateMediaSource(media('workspace'))).resolves.toEqual({
			mediaId: 'media',
			fileName: 'old.mp4',
			kind: 'missing'
		});
	});

	it('reprobes a replacement, keeps custom tags, and invalidates derived data before publish', async () => {
		const testRuntime = runtime();
		const file = new File([new Uint8Array(400)], 'restored.mp4', {
			type: 'video/mp4',
			lastModified: 123
		});
		// SAFETY: relinkMediaSource only calls getFile on this test handle.
		const handle = { getFile: async () => file, name: file.name } as FileSystemFileHandle;

		const restored = await testRuntime.recovery.relinkMediaSource(media(), handle);

		expect(testRuntime.calls.updates).toEqual([
			{
				mediaId: 'media',
				updates: expect.objectContaining({
					storageType: 'handle',
					fileHandle: handle,
					fileName: 'restored.mp4',
					fileSize: 400,
					duration: 4,
					width: 1920,
					height: 1080,
					fps: 24,
					frameRateMetrics: expect.objectContaining({
						underlyingFrameRate: null,
						bestGuessFrameRate: 24,
						frameRateIsConstant: false
					}),
					codec: 'avc1',
					tags: ['favorite', 'video']
				})
			}
		]);
		expect(testRuntime.calls.writtenSources).toEqual([]);
		expect(testRuntime.calls.writtenThumbnails).toHaveLength(1);
		expect(testRuntime.calls.invalidated).toEqual(['media']);
		expect(testRuntime.calls.published).toEqual([restored]);
	});

	it('rejects a replacement with a different media kind before persistence', async () => {
		const testRuntime = runtime();
		testRuntime.setReplacementKind('audio');
		const file = new File(['audio'], 'wrong.wav', { type: 'audio/wav' });
		// SAFETY: relinkMediaSource only calls getFile on this test handle.
		const handle = { getFile: async () => file, name: file.name } as FileSystemFileHandle;

		await expect(testRuntime.recovery.relinkMediaSource(media(), handle)).rejects.toThrow(
			/Choose a video file/
		);
		expect(testRuntime.calls.updates).toEqual([]);
		expect(testRuntime.calls.writtenSources).toEqual([]);
	});
});
