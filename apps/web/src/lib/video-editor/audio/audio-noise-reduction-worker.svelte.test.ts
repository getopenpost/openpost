import { afterEach, expect, it } from 'vitest';
import {
	processPreviewNoiseReduction,
	disposeNoiseReductionPreviewWorker
} from './audio-noise-reduction-preview';
import type {
	NoiseReductionCompleteResponse,
	NoiseReductionErrorResponse,
	NoiseReductionProgressResponse,
	NoiseReductionRequest
} from './audio-noise-reduction.worker';

it('stops cancelled noise reduction between chunks before serving the next request', async () => {
	const worker = new Worker(new URL('./audio-noise-reduction.worker.ts', import.meta.url), {
		type: 'module'
	});
	const finished = Promise.withResolvers<void>();
	let cancelled = false;
	let obsoleteCompleted = false;
	worker.addEventListener('error', (event) => finished.reject(new Error(event.message)));
	worker.addEventListener(
		'message',
		(
			event: MessageEvent<
				| NoiseReductionCompleteResponse
				| NoiseReductionProgressResponse
				| NoiseReductionErrorResponse
			>
		) => {
			const message = event.data;
			if (message.type === 'error') finished.reject(new Error(message.error));
			if (message.requestId === 'obsolete' && message.type === 'progress' && !cancelled) {
				cancelled = true;
				worker.postMessage({ type: 'abort', requestId: 'obsolete' });
				// An equally long successor cannot hide an obsolete job still running between yields.
				const next = new Float32Array(9_600_000);
				worker.postMessage(
					{
						type: 'process',
						requestId: 'next',
						sampleRate: 48000,
						amount: 50,
						channelBuffers: [next.buffer],
						channelLengths: [next.length]
					} satisfies NoiseReductionRequest,
					[next.buffer]
				);
			}
			if (message.type === 'complete') {
				if (message.requestId === 'obsolete') obsoleteCompleted = true;
				if (message.requestId === 'next') finished.resolve();
			}
		}
	);
	try {
		// Long enough for the main thread to cancel after the first bounded chunk.
		const input = new Float32Array(9_600_000);
		worker.postMessage(
			{
				type: 'process',
				requestId: 'obsolete',
				sampleRate: 48000,
				amount: 50,
				channelBuffers: [input.buffer],
				channelLengths: [input.length]
			} satisfies NoiseReductionRequest,
			[input.buffer]
		);
		await finished.promise;
		expect(cancelled).toBe(true);
		expect(obsoleteCompleted).toBe(false);
	} finally {
		worker.terminate();
	}
}, 15000);

afterEach(() => disposeNoiseReductionPreviewWorker());

it('assembles all filtered samples across worker chunk boundaries', async () => {
	const input = Float32Array.from(
		{ length: 240_512 },
		(_, index) => 0.3 * Math.sin((2 * Math.PI * 1000 * index) / 48000)
	);
	const output = await processPreviewNoiseReduction([input], 48000, { enabled: true, amount: 50 });
	expect(output).toHaveLength(1);
	expect(output[0]).toHaveLength(input.length);
	let dot = 0,
		inputEnergy = 0,
		outputEnergy = 0;
	for (let index = 0; index < input.length; index++) {
		dot += input[index]! * output[0]![index]!;
		inputEnergy += input[index]! ** 2;
		outputEnergy += output[0]![index]! ** 2;
	}
	expect(dot / Math.sqrt(inputEnergy * outputEnergy)).toBeGreaterThan(0.8);
});
