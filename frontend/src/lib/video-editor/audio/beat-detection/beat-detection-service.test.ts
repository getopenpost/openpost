/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { createBeatDetectionService } from './beat-detection-service.svelte';
import { BeatAnalyzer } from './analyzer';

const media: MediaMetadata = {
	id: 'media-audio',
	storageType: 'workspace',
	fileName: 'beat.wav',
	fileSize: 1000,
	mimeType: 'audio/wav',
	duration: 4,
	width: 0,
	height: 0,
	fps: 0,
	codec: 'pcm',
	audioCodec: 'pcm',
	audioCodecSupported: true,
	tags: ['audio']
};

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip-1',
		trackId: 'track-audio',
		from: 0,
		durationInFrames: 120,
		label: 'Beat clip',
		type: 'audio',
		mediaId: media.id,
		sourceStart: 0,
		sourceEnd: 120,
		sourceFps: 30,
		...overrides
	};
}

function mockAudioContext(): void {
	const decodeMock = vi.fn(async () => {
		const buffer = {
			numberOfChannels: 1,
			length: 48_000,
			sampleRate: 48_000,
			duration: 1,
			getChannelData: () => new Float32Array(48_000)
		};
		// SAFETY: test-only AudioBuffer mock - only numberOfChannels, length, sampleRate, duration and getChannelData are used
		return buffer as AudioBuffer;
	});
	class MockAudioContext {
		decodeAudioData = decodeMock;
		close = vi.fn(async () => {});
	}
	// oxlint-disable-next-line anti-slop
	vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
}

describe('beat detection service - worker fallback and cancellation', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		mediaPool.clear();
		mediaPool.upsert(media, 'ready');
		timelineStore.setAll({
			tracks: [
				{
					id: 'track-audio',
					name: 'Audio',
					kind: 'audio',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [clip()],
			fps: 30,
			markers: []
		});
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('falls back to main thread when worker construction throws', async () => {
		mockAudioContext();
		const fallbackSpy = vi.spyOn(BeatAnalyzer.prototype, 'analyzeBlob').mockResolvedValue({
			bpm: 120,
			confidence: 0.9,
			beats: [{ time: 0, strength: 1, index: 0 }],
			duration: 1,
			downbeats: [0]
		});
		const service = createBeatDetectionService({
			resolveMediaBlob: async () => new Blob([new Uint8Array(10)]),
			createWorker: () => {
				throw new Error('Worker construction failed');
			}
		});
		const result = await service.analyzeSelectedClip('clip-1');
		expect(result.status).toBe('success');
		expect(fallbackSpy).toHaveBeenCalledTimes(1);
		expect(timelineStore.markers).toHaveLength(1);
	});

	it('surfaces worker analysis error without second render', async () => {
		mockAudioContext();
		const resolveSpy = vi.fn(async () => new Blob([new Uint8Array(10)]));
		const analyzeSpy = vi.fn(async () => ({
			bpm: 120,
			confidence: 0.9,
			beats: [{ time: 0, strength: 1, index: 0 }],
			duration: 1,
			downbeats: [0]
		}));
		vi.spyOn(BeatAnalyzer.prototype, 'analyzeBlob').mockImplementation(analyzeSpy);
		const fakeWorker = {
			addEventListener: vi.fn(
				(
					event: string,
					handler: (event: { data: { id: string; ok: boolean; error: string } }) => void
				) => {
					if (event === 'message') {
						setTimeout(
							() => handler({ data: { id: 'test', ok: false, error: 'Worker analysis failed' } }),
							0
						);
					}
				}
			),
			removeEventListener: vi.fn(),
			postMessage: vi.fn(),
			terminate: vi.fn()
		};
		// SAFETY: test-only Worker mock - only addEventListener, removeEventListener, postMessage and terminate are used
		const workerMock = fakeWorker as Worker;
		const service = createBeatDetectionService({
			resolveMediaBlob: resolveSpy,
			createWorker: () => workerMock
		});
		const originalRandomUUID = crypto.randomUUID;
		vi.stubGlobal('crypto', {
			...crypto,
			randomUUID: () => 'test'
		});
		await expect(service.analyzeSelectedClip('clip-1')).rejects.toThrow('Worker analysis failed');
		expect(analyzeSpy).not.toHaveBeenCalled();
		expect(service.status).toBe('error');
		expect(timelineStore.markers).toHaveLength(0);
		vi.stubGlobal('crypto', { ...crypto, randomUUID: originalRandomUUID });
	});

	it('preserves AbortError and does not fallback on cancellation', async () => {
		const service = createBeatDetectionService({
			resolveMediaBlob: async () => new Blob([new Uint8Array(10)]),
			analyzeBlob: (_blob: Blob, signal?: AbortSignal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener('abort', () =>
						reject(new DOMException('Cancelled', 'AbortError'))
					);
				})
		});
		const promise = service.analyzeSelectedClip('clip-1');
		service.cancel();
		const result = await promise;
		expect(result.status).toBe('cancelled');
		expect(service.status).toBe('cancelled');
	});

	it('falls back on DataCloneError message', async () => {
		mockAudioContext();
		const fallbackSpy = vi.spyOn(BeatAnalyzer.prototype, 'analyzeBlob').mockResolvedValue({
			bpm: 100,
			confidence: 0.8,
			beats: [{ time: 0, strength: 1, index: 0 }],
			duration: 1,
			downbeats: [0]
		});
		const fakeWorker = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			postMessage: vi.fn(() => {
				throw new DOMException('DataCloneError', 'DataCloneError');
			}),
			terminate: vi.fn()
		};
		// SAFETY: test-only Worker mock - only addEventListener, removeEventListener, postMessage and terminate are used
		const workerMock = fakeWorker as Worker;
		const service = createBeatDetectionService({
			resolveMediaBlob: async () => new Blob([new Uint8Array(10)]),
			createWorker: () => workerMock
		});
		const result = await service.analyzeSelectedClip('clip-1');
		expect(result.status).toBe('success');
		expect(fallbackSpy).toHaveBeenCalled();
	});
});
