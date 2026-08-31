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

function getWorker(): Worker | null {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- worker availability probe
	if (typeof Worker === 'undefined') return null;
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./audio-noise-reduction.worker.ts', import.meta.url), {
			type: 'module'
		});
		return worker;
	} catch {
		return null;
	}
}

export function disposeNoiseReductionPreviewWorker(): void {
	if (worker) {
		worker.terminate();
		worker = null;
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

	const requestId = crypto.randomUUID();
	const channelBuffers = channels.map((ch) => {
		const copy = new Float32Array(ch);
		return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
	});
	const channelLengths = channels.map((ch) => ch.length);

	return new Promise((resolve, reject) => {
		const handleAbort = (): void => {
			cleanup();
			// SAFETY: abort payload matches worker's typed discriminant.
			w.postMessage({
				type: 'abort',
				requestId
			} satisfies NoiseReductionAbort);
			reject(new DOMException('Aborted', 'AbortError'));
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

		const onError = (e: ErrorEvent): void => {
			cleanup();
			reject(e.error ?? new Error(e.message));
		};

		function cleanup(): void {
			signal?.removeEventListener('abort', handleAbort);
			w.removeEventListener('message', onMessage);
			w.removeEventListener('error', onError);
		}

		w.addEventListener('message', onMessage);
		w.addEventListener('error', onError);
		// SAFETY: request payload matches worker's typed contract; buffers are transferred.
		w.postMessage(
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
	});
}
