import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
	disposeNoiseReductionPreviewWorker,
	processPreviewNoiseReduction
} from './audio-noise-reduction-preview';
import type { NoiseReductionRequest, NoiseReductionAbort } from './audio-noise-reduction.worker';

class ControlledWorker extends EventTarget {
	static instances: ControlledWorker[] = [];
	requests: Array<NoiseReductionRequest | NoiseReductionAbort> = [];
	terminated = false;
	constructor() {
		super();
		ControlledWorker.instances.push(this);
	}
	postMessage(message: NoiseReductionRequest | NoiseReductionAbort) {
		this.requests.push(message);
	}
	terminate() {
		this.terminated = true;
	}
	complete() {
		const request = this.requests.find((message) => message.type === 'process')!;
		this.dispatchEvent(
			new MessageEvent('message', {
				data: {
					type: 'complete',
					requestId: request.requestId,
					channelBuffers: [new Float32Array([0.25]).buffer],
					channelLengths: [1]
				}
			})
		);
	}
}

interface ProcessingResult {
	status: 'pending' | 'resolved' | 'rejected';
	error?: unknown;
	value?: Float32Array[];
}

function observe(promise: Promise<Float32Array[]>) {
	const result: ProcessingResult = { status: 'pending' };
	void promise.then(
		(value) => {
			result.status = 'resolved';
			result.value = value;
		},
		(error) => {
			result.status = 'rejected';
			result.error = error;
		}
	);
	return result;
}
function process(signal?: AbortSignal) {
	return processPreviewNoiseReduction(
		[new Float32Array([0.5])],
		48000,
		{ enabled: true, amount: 50 },
		signal
	);
}
beforeEach(() => {
	ControlledWorker.instances = [];
	vi.stubGlobal('Worker', ControlledWorker);
});
afterEach(() => {
	disposeNoiseReductionPreviewWorker();
	vi.unstubAllGlobals();
});

it('rejects every pending preview when its noise-reduction worker is disposed', async () => {
	const first = observe(process());
	const second = observe(process());
	disposeNoiseReductionPreviewWorker();
	await expect.poll(() => [first.status, second.status]).toEqual(['rejected', 'rejected']);
	expect(first.error).toMatchObject({ name: 'AbortError' });
	expect(second.error).toMatchObject({ name: 'AbortError' });
});

it.each(['error', 'messageerror'])(
	'replaces a failed noise-reduction worker after %s',
	async (event) => {
		const first = observe(process());
		const worker = ControlledWorker.instances[0]!;
		worker.dispatchEvent(new Event(event));
		await expect.poll(() => first.status).toBe('rejected');
		const retry = observe(process());
		const replacement = ControlledWorker.instances.at(-1)!;
		expect(replacement).not.toBe(worker);
		expect(worker.terminated).toBe(true);
		replacement.complete();
		await expect.poll(() => retry.status).toBe('resolved');
		expect([...retry.value![0]!]).toEqual([0.25]);
	}
);

it('cancels one preview without interrupting another caller', async () => {
	const controller = new AbortController();
	const first = observe(process(controller.signal));
	const second = observe(process());
	const worker = ControlledWorker.instances[0]!;
	controller.abort();
	await expect.poll(() => first.status).toBe('rejected');
	expect(worker.terminated).toBe(false);
	const request = worker.requests.filter((message) => message.type === 'process')[1]!;
	worker.dispatchEvent(
		new MessageEvent('message', {
			data: {
				type: 'complete',
				requestId: request.requestId,
				channelBuffers: [new Float32Array([0.25]).buffer],
				channelLengths: [1]
			}
		})
	);
	await expect.poll(() => second.status).toBe('resolved');
});
