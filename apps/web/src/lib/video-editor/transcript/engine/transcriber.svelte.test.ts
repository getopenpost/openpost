import { expect, it, vi } from 'vitest';
import silentVideoUrl from '../../media/fixtures/prores-proxy.mov?url';
import { BrowserTranscriber } from './transcriber';

it('explains a silent video without starting a model download', async () => {
	const blob = await (await fetch(silentVideoUrl)).blob();
	const progress = vi.fn();
	const job = new BrowserTranscriber().transcribe(
		new File([blob], 'silent.mov', { type: 'video/quicktime' }),
		{ model: 'whisper-tiny', onProgress: progress }
	);
	const consume = async () => {
		for await (const segment of job) void segment;
	};
	await expect(consume()).rejects.toThrow(
		'This recording has no audio. Record with a microphone or choose a clip with speech.'
	);
	expect(progress.mock.calls.some(([event]) => event.stage === 'downloading')).toBe(false);
});
