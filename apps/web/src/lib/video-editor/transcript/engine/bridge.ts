import { MODEL_IDS, type MainThreadMessage, type TranscriptionEngine } from './types';
import type {
	TranscribeProgress,
	TranscribeRuntimeInfo,
	TranscriptionModel,
	TranscriptionQuantization,
	TranscriptSegment
} from './types';
import {
	acquireTranscriptionWorker,
	disposeTranscriptionWorker,
	onTranscriptionWorkerUnload,
	releaseTranscriptionWorker
} from './lib/transcription-worker-pool';

export interface TranscriptionBridgeCallbacks {
	onSegment: (segment: TranscriptSegment) => void;
	onProgress: (event: TranscribeProgress) => void;
	onRuntimeInfo: (info: TranscribeRuntimeInfo) => void;
	onDone: () => void;
	onError: (message: string) => void;
}

/**
 * One transcription job. Audio decoding stays in a short-lived worker while the heavy ASR
 * worker remains warm for the next job. MessageChannel backpressure caps decoded PCM in memory.
 */
export class TranscriptionBridge {
	private readonly callbacks: TranscriptionBridgeCallbacks;
	private decoder: Worker | null = null;
	private engineWorker: Worker | null = null;
	private activeEngine: TranscriptionEngine = 'whisper';
	private detachEngine: (() => void) | null = null;
	private closePorts: (() => void) | null = null;
	private detachUnload: (() => void) | null = null;
	private ended = false;

	constructor(callbacks: TranscriptionBridgeCallbacks) {
		this.callbacks = callbacks;
	}

	start(
		file: File,
		model: TranscriptionModel,
		language: string | undefined,
		quantization: TranscriptionQuantization,
		engine: TranscriptionEngine,
		sourceStartSeconds = 0,
		sourceEndSeconds?: number
	): void {
		if (this.decoder || this.engineWorker) throw new Error('Transcription job already started');
		this.activeEngine = engine;
		const engineWorker = acquireTranscriptionWorker(engine);
		const decoder = new Worker(new URL('./workers/decoder.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.engineWorker = engineWorker;
		this.decoder = decoder;

		const handleEngineMessage = (event: MessageEvent<MainThreadMessage>): void => {
			if (this.ended) return;
			const message = event.data;
			if (message.type === 'segment') this.callbacks.onSegment(message.segment);
			else if (message.type === 'progress') this.callbacks.onProgress(message.event);
			else if (message.type === 'runtime') this.callbacks.onRuntimeInfo(message.info);
			else if (message.type === 'done') {
				this.callbacks.onDone();
				this.finish(false);
			} else if (message.type === 'error') {
				this.callbacks.onError(message.message);
				this.finish(true);
			}
		};
		const handleEngineError = (event: ErrorEvent): void => {
			this.callbacks.onError(event.message || `${engine} worker failed`);
			this.finish(true);
		};
		engineWorker.addEventListener('message', handleEngineMessage);
		engineWorker.addEventListener('error', handleEngineError);
		this.detachEngine = () => {
			engineWorker.removeEventListener('message', handleEngineMessage);
			engineWorker.removeEventListener('error', handleEngineError);
		};
		this.detachUnload = onTranscriptionWorkerUnload(engine, () => {
			if (this.ended) return;
			this.callbacks.onError('Local transcription model was unloaded');
			this.finish(false);
		});

		decoder.onmessage = (event: MessageEvent<MainThreadMessage>): void => {
			if (this.ended) return;
			if (event.data.type === 'progress') this.callbacks.onProgress(event.data.event);
			else if (event.data.type === 'error') {
				this.callbacks.onError(`Audio decoder: ${event.data.message}`);
				this.finish(true);
			}
		};
		decoder.onerror = (event): void => {
			this.callbacks.onError(event.message || 'Audio decoder failed');
			this.finish(true);
		};

		const { port1, port2 } = new MessageChannel();
		this.closePorts = () => {
			port1.close();
			port2.close();
		};
		decoder.postMessage({ type: 'port', port: port1 }, [port1]);
		engineWorker.postMessage({ type: 'port', port: port2 }, [port2]);
		engineWorker.postMessage({
			type: 'init',
			modelId: MODEL_IDS[model],
			language: language || undefined,
			quantization
		});
		decoder.postMessage({
			type: 'init',
			file,
			sourceStartSeconds,
			sourceEndSeconds
		});
	}

	setPaused(paused: boolean): void {
		if (this.ended) return;
		const message = { type: paused ? 'pause' : 'resume' };
		this.engineWorker?.postMessage(message);
		this.decoder?.postMessage(message);
	}

	cancel(): void {
		if (this.ended) return;
		this.finish(true);
	}

	private finish(disposeEngine: boolean): void {
		if (this.ended) return;
		this.ended = true;
		this.detachEngine?.();
		this.detachEngine = null;
		this.detachUnload?.();
		this.detachUnload = null;
		this.decoder?.terminate();
		this.decoder = null;
		this.closePorts?.();
		this.closePorts = null;
		if (this.engineWorker) {
			if (disposeEngine) disposeTranscriptionWorker(this.activeEngine);
			else releaseTranscriptionWorker(this.activeEngine);
			this.engineWorker = null;
		}
	}
}
