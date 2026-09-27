import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { TranscriptionService, type TranscriptionJobView } from './transcription-service.svelte';
import { mediaPool } from '../media/pool.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

afterEach(() => {
	mediaPool.clear();
	timelineStore.__resetForTesting();
});

it('reactively reports a newly started caption job and clears it after a source failure', async () => {
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
	const result = service.enqueue('clip', { model: 'whisper-tiny', quantization: 'q8' });
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
		dispose();
	}
});
