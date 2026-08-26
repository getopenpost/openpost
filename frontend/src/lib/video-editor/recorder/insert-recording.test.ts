import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { MediaMetadata } from '../media/types';
import type { CaptureArtifact } from './recorder.svelte';
import { insertRecordingArtifacts, type RecordingImportRuntime } from './insert-recording';

function artifact(kind: CaptureArtifact['kind'], startOffsetMs: number): CaptureArtifact {
	return {
		kind,
		blob: new Blob([kind], { type: kind === 'microphone' ? 'audio/webm' : 'video/webm' }),
		mimeType: kind === 'microphone' ? 'audio/webm' : 'video/webm',
		durationMs: 1_000,
		startOffsetMs,
		sizeBytes: kind.length
	};
}

function media(id: string, kind: 'video' | 'audio'): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.webm`,
		fileSize: 100,
		mimeType: `${kind}/webm`,
		duration: 1,
		width: kind === 'video' ? 1920 : 0,
		height: kind === 'video' ? 1080 : 0,
		fps: kind === 'video' ? 24 : 0,
		codec: kind === 'video' ? 'vp9' : 'opus',
		bitrate: 800,
		tags: [kind]
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [], items: [], fps: 30 });
});

describe('recording artifact insertion', () => {
	it('inserts aligned native-rate clips as one undoable timeline action', async () => {
		const runtime: RecordingImportRuntime = {
			importVideo: vi.fn(async () => media('screen-media', 'video')),
			importAudio: vi.fn(async () => media('mic-media', 'audio')),
			rollback: vi.fn(async () => undefined)
		};

		const result = await insertRecordingArtifacts(
			'project',
			[artifact('screen', 0), artifact('microphone', 100)],
			60,
			runtime
		);

		expect(result.mediaIds).toEqual(['screen-media', 'mic-media']);
		expect(timelineStore.tracks).toHaveLength(2);
		expect(timelineStore.items).toHaveLength(2);
		const screen = timelineStore.items.find((item) => item.mediaId === 'screen-media');
		const microphone = timelineStore.items.find((item) => item.mediaId === 'mic-media');
		expect(screen).toMatchObject({
			from: 60,
			durationInFrames: 30,
			sourceFps: 24,
			sourceEnd: 24,
			sourceDuration: 24
		});
		expect(microphone).toMatchObject({
			from: 63,
			durationInFrames: 30,
			sourceFps: 30,
			sourceEnd: 30,
			sourceDuration: 30
		});

		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(0);
		expect(timelineStore.tracks).toHaveLength(0);
	});

	it('rolls back every earlier media import when a later artifact fails', async () => {
		const rollback = vi.fn(async () => undefined);
		const runtime: RecordingImportRuntime = {
			importVideo: vi
				.fn()
				.mockResolvedValueOnce(media('screen-media', 'video'))
				.mockRejectedValueOnce(new Error('camera probe failed')),
			importAudio: vi.fn(async () => media('mic-media', 'audio')),
			rollback
		};

		await expect(
			insertRecordingArtifacts(
				'project',
				[artifact('screen', 0), artifact('camera', 20)],
				0,
				runtime
			)
		).rejects.toThrow('camera probe failed');
		expect(rollback).toHaveBeenCalledExactlyOnceWith('project', 'screen-media');
		expect(timelineStore.items).toHaveLength(0);
		expect(timelineStore.tracks).toHaveLength(0);
	});
});
