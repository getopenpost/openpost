import type { ResolvedAudioNoiseReductionSettings } from './audio-noise-reduction';
import { applyNoiseReduction } from './audio-noise-reduction';
import type {
	NoiseReductionAbort,
	NoiseReductionCompleteResponse,
	NoiseReductionErrorResponse,
	NoiseReductionProgressResponse,
	NoiseReductionRequest
} from './audio-noise-reduction.worker';

let worker: Worker | null = null;
const pendingFailures = new Map<string, (error: Error) => void>();

function failWorker(activeWorker: Worker, error: Error): void {
	if (worker !== activeWorker) return;
	worker = null;
	activeWorker.terminate();
	for (const fail of [...pendingFailures.values()]) fail(error);
}

function getWorker(): Worker | null {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- worker availability probe
	if (typeof Worker === 'undefined') return null;
	if (worker) return worker;
	try {
		const activeWorker = new Worker(new URL('./audio-noise-reduction.worker.ts', import.meta.url), {
			type: 'module'
		});
		worker = activeWorker;
		activeWorker.addEventListener('error', (event: ErrorEvent) => {
			failWorker(
				activeWorker,
				event.error instanceof Error ? event.error : new Error(event.message)
			);
		});
		activeWorker.addEventListener('messageerror', () => {
			failWorker(activeWorker, new Error('Noise-reduction response could not be read.'));
		});
		return worker;
	} catch {
		return null;
	}
}

export function disposeNoiseReductionPreviewWorker(): void {
	if (worker) {
		failWorker(worker, new DOMException('Noise-reduction preview closed.', 'AbortError'));
	}
}

function previewTransferOptions(buffers: ArrayBuffer[]): StructuredSerializeOptions {
	return { transfer: buffers };
}

type WorkerResponse =
	| NoiseReductionProgressResponse
	| NoiseReductionCompleteResponse
	| NoiseReductionErrorResponse;

export async function processPreviewNoiseReduction(
	channels: Float32Array[],
	sampleRate: number,
	settings: ResolvedAudioNoiseReductionSettings,
	signal?: AbortSignal,
	onProgress?: (progress: number) => void
): Promise<Float32Array[]> {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	const w = getWorker();
	if (!w) {
		return applyNoiseReduction(channels, sampleRate, settings, signal);
	}
	const activeWorker = w;

	const requestId = crypto.randomUUID();
	const channelBuffers = channels.map((ch) => {
		const copy = new Float32Array(ch);
		return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
	});
	const channelLengths = channels.map((ch) => ch.length);

	return new Promise((resolve, reject) => {
		const handleAbort = (): void => {
			cleanup();
			reject(new DOMException('Aborted', 'AbortError'));
			try {
				activeWorker.postMessage({
					type: 'abort',
					requestId
				} satisfies NoiseReductionAbort);
			} catch {
				// Cancellation is settled even if the worker can no longer receive it.
			}
		};
		signal?.addEventListener('abort', handleAbort, { once: true });

		const onMessage = (event: MessageEvent): void => {
			// SAFETY: messages are from the owned worker module; narrow by discriminant.
			const data = event.data as WorkerResponse;
			if (!data || data.requestId !== requestId) return;
			if (data.type === 'progress') {
				onProgress?.(data.progress);
				return;
			}
			if (data.type === 'complete') {
				cleanup();
				const out = data.channelBuffers.map((ab, i) =>
					// SAFETY: lengths are 1:1 with buffers by worker contract.
					new Float32Array(ab).slice(0, data.channelLengths[i]!)
				);
				resolve(out);
				return;
			}
			if (data.type === 'error') {
				cleanup();
				reject(new Error(data.error));
			}
		};

		function cleanup(): void {
			pendingFailures.delete(requestId);
			signal?.removeEventListener('abort', handleAbort);
			activeWorker.removeEventListener('message', onMessage);
		}

		pendingFailures.set(requestId, (error) => {
			cleanup();
			reject(error);
		});
		activeWorker.addEventListener('message', onMessage);
		// SAFETY: request payload matches worker's typed contract; buffers are transferred.
		try {
			activeWorker.postMessage(
				{
					type: 'process',
					requestId,
					sampleRate,
					amount: settings.amount,
					channelBuffers,
					channelLengths
				} satisfies NoiseReductionRequest,
				previewTransferOptions(channelBuffers)
			);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}
