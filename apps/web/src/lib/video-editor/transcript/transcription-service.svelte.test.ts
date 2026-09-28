import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TranscriptionService, type TranscriptionJobView } from './transcription-service.svelte';
import { mediaPool } from '../media/pool.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

afterEach(() => {
	mediaPool.clear();
	timelineStore.__resetForTesting();
});

it('reactively reports a newly started caption job and retains the error after a source failure', async () => {
	mediaPool.upsert(
		{
			id: 'recording',
			storageType: 'cloud',
			remoteUrl: '/recording.wav',
			fileName: 'recording.wav',
			fileSize: 4,
			mimeType: 'audio/wav',
			duration: 1,
			width: 0,
			height: 0,
			fps: 30,
			codec: 'pcm',
			bitrate: 0,
			tags: []
		},
		'ready'
	);
	timelineStore._setItems([
		{
			id: 'clip',
			label: 'clip',
			mediaId: 'recording',
			type: 'audio',
			trackId: 'audio',
			from: 0,
			durationInFrames: 30,
			sourceStart: 0,
			sourceEnd: 30,
			sourceFps: 30
		}
	]);
	const source = Promise.withResolvers<Blob>();
	const resolveSource = vi.fn(() => source.promise);
	const service = new TranscriptionService({
		resolveSource,
		transcribe: vi.fn(),
		getSourceTranscript: async () => null,
		saveSourceTranscript: vi.fn(),
		deleteSourceTranscript: vi.fn()
	});
	let observed: TranscriptionJobView | undefined;
	const dispose = $effect.root(() => {
		$effect(() => {
			observed = service.jobForItem('clip');
		});
	});
	flushSync();
	const result = service.enqueue('clip', {
		model: 'whisper-tiny',
		quantization: 'q8'
	});
	const outcome = result.catch((error: Error) => error);
	try {
		await expect.poll(() => resolveSource.mock.calls.length).toBe(1);
		flushSync();
		expect(observed?.status).toBe('running');
	} finally {
		source.reject(new Error('Recording unavailable'));
		const error = await outcome;
		expect(error).toBeInstanceOf(Error);
		flushSync();
		expect(observed).toBeUndefined();
		expect(service.errorForItem('clip')).toBe('Recording unavailable');
		dispose();
	}
});

it('rejects a known silent recording before resolving media or starting a model', async () => {
	mediaPool.upsert(
		{
			id: 'silent',
			storageType: 'cloud',
			remoteUrl: '/silent.webm',
			fileName: 'silent.webm',
			fileSize: 4,
			mimeType: 'video/webm',
			duration: 1,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'vp9',
			bitrate: 0,
			tags: [],
			hasAudio: false
		},
		'ready'
	);
	timelineStore._setItems([
		{
			id: 'silent-clip',
			label: 'Screen',
			mediaId: 'silent',
			type: 'video',
			trackId: 'video',
			from: 0,
			durationInFrames: 30
		}
	]);
	const resolveSource = vi.fn();
	const transcribe = vi.fn();
	const service = new TranscriptionService({
		resolveSource,
		transcribe,
		getSourceTranscript: async () => null,
		saveSourceTranscript: vi.fn(),
		deleteSourceTranscript: vi.fn()
	});
	await expect(
		service.enqueue('silent-clip', { model: 'whisper-tiny', quantization: 'q8' })
	).rejects.toThrow(
		'This recording has no audio. Record with a microphone or choose a clip with speech.'
	);
	expect(resolveSource).not.toHaveBeenCalled();
	expect(transcribe).not.toHaveBeenCalled();
});
