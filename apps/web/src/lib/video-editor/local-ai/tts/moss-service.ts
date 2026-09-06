// Browser runtime and model-store behavior ported from FreeCut (MIT), with
// abortable worker ownership and OpenPost's shared audio/output contracts.
import {
	applyPlaybackSpeed,
	audioDurationSeconds,
	concatenateFloat32,
	createFloat32WavBlob
} from '../audio';
import { sanitizeAiOutputFileNameSegment } from '../output-file-name';
import type { GeneratedAudio, LocalGenerationProgress } from '../types';
import { localAiRuntimeRegistry } from '../runtime-registry';
import { validateTtsGenerateRequest } from './validation';

const HOST_SOURCE = 'openpost-moss-tts-worker';
const CLIENT_SOURCE = 'openpost-moss-tts-client';
const MODEL_LABEL = 'MOSS Nano';
const THREAD_COUNT = 4;
const TOTAL_MODEL_FILES = 16;

interface SerializedAudioChunk {
	sampleRate: number;
	channels: number;
	isPause?: boolean;
	buffers: ArrayBuffer[];
}

interface WorkerProgress {
	source: typeof HOST_SOURCE;
	type: 'progress';
	requestId: string;
	stage?: string;
	repoId?: string;
	fileIndex?: number;
	fileCount?: number;
}

interface WorkerResponse {
	source: typeof HOST_SOURCE;
	type: 'response';
	requestId: string;
	ok: boolean;
	error?: string;
	data?: {
		status?: string;
		audioChunks?: SerializedAudioChunk[];
		textChunkCount?: number;
	};
}

interface WorkerReady {
	source: typeof HOST_SOURCE;
	type: 'ready';
}

interface PendingRequest {
	onProgress?: (progress: LocalGenerationProgress) => void;
	resolve: (value: WorkerResponse['data']) => void;
	reject: (reason: WorkerFailure) => void;
	abortCleanup?: () => void;
}

type WorkerFailure = Error | DOMException;

interface MossWorkerPayload {
	text?: string;
	voiceName?: MossTtsVoice;
}

interface MergedChunkAudio {
	channels: Float32Array[];
	sampleRate: number;
}

export interface MossGenerateOptions {
	text: string;
	voice: MossTtsVoice;
	speed: number;
	signal?: AbortSignal;
	onProgress?: (progress: LocalGenerationProgress) => void;
}

export const MOSS_TTS_VOICE_OPTIONS = [
	{ value: 'Junhao', label: 'Junhao (ZH, M)' },
	{ value: 'Zhiming', label: 'Zhiming (ZH, M)' },
	{ value: 'Weiguo', label: 'Weiguo (ZH, M)' },
	{ value: 'Xiaoyu', label: 'Xiaoyu (ZH, F)' },
	{ value: 'Yuewen', label: 'Yuewen (ZH, F)' },
	{ value: 'Lingyu', label: 'Lingyu (ZH, F)' },
	{ value: 'Trump', label: 'Trump (EN, M)' },
	{ value: 'Ava', label: 'Ava (EN, F)' },
	{ value: 'Bella', label: 'Bella (EN, F)' },
	{ value: 'Adam', label: 'Adam (EN, M)' },
	{ value: 'Nathan', label: 'Nathan (EN, M)' },
	{ value: 'Soyo', label: 'Soyo (JA, F)' },
	{ value: 'Saki', label: 'Saki (JA, F)' },
	{ value: 'Mortis', label: 'Mortis (JA, F)' },
	{ value: 'Umiri', label: 'Umiri (JA, F)' },
	{ value: 'Mei', label: 'Mei (JA, F)' },
	{ value: 'Anon', label: 'Anon (JA, F)' },
	{ value: 'Arisa', label: 'Arisa (JA, F)' }
] as const;

export type MossTtsVoice = (typeof MOSS_TTS_VOICE_OPTIONS)[number]['value'];

export const MOSS_TTS_SUPPORTED_LANGUAGES = [
	'Chinese',
	'English',
	'Japanese',
	'Korean',
	'Spanish',
	'French',
	'German',
	'Italian',
	'Hungarian',
	'Russian',
	'Persian',
	'Arabic',
	'Polish',
	'Portuguese',
	'Czech',
	'Danish',
	'Swedish',
	'Greek',
	'Turkish'
] as const;

function createOutputFileName(text: string, voice: MossTtsVoice): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `ai-tts-${sanitizeAiOutputFileNameSegment(text, 'speech')}-${sanitizeAiOutputFileNameSegment(voice, 'speech')}-moss-${timestamp}.wav`;
}

function mergeChunkChannels(audioChunks: SerializedAudioChunk[]): MergedChunkAudio {
	let sampleRate = 0;
	let channelCount = 0;
	const chunksByChannel: Float32Array[][] = [];
	for (const chunk of audioChunks) {
		const channels = chunk.buffers.map((buffer) => new Float32Array(buffer));
		if (channels.length === 0) continue;
		if (sampleRate === 0) sampleRate = chunk.sampleRate;
		if (chunk.sampleRate !== sampleRate) {
			throw new Error('MOSS TTS returned audio with mixed sample rates.');
		}
		if (channelCount === 0) {
			channelCount = chunk.channels || channels.length;
			for (let index = 0; index < channelCount; index += 1) chunksByChannel.push([]);
		}
		const fallbackLength = channels[0]?.length ?? 0;
		for (let index = 0; index < channelCount; index += 1) {
			chunksByChannel[index]?.push(channels[index] ?? new Float32Array(fallbackLength));
		}
	}
	return {
		channels: chunksByChannel.map(concatenateFloat32),
		sampleRate
	};
}

function stageProgress(message: string, payload: WorkerProgress): LocalGenerationProgress {
	if (/Scanning|Downloading|Using verified|existing browser-managed/i.test(message)) {
		let completed = 0;
		if (/existing browser-managed/i.test(message)) completed = TOTAL_MODEL_FILES;
		if (payload.repoId?.includes('Audio-Tokenizer')) completed = 10;
		if (payload.fileIndex) completed += Math.max(0, payload.fileIndex - 1);
		return {
			stage: 'downloading',
			message,
			progress: Math.min(completed / TOTAL_MODEL_FILES, 0.99),
			backend: 'wasm'
		};
	}
	if (/Warming|Preparing/i.test(message)) {
		return { stage: 'preparing', message, progress: null, backend: 'wasm' };
	}
	return { stage: 'generating', message, progress: null, backend: 'wasm' };
}

function abortError(): DOMException {
	return new DOMException('Speech generation cancelled', 'AbortError');
}

class MossTtsService {
	private worker: Worker | null = null;
	private workerReadyPromise: Promise<void> | null = null;
	private workerReadyResolve: (() => void) | null = null;
	private workerReadyReject: ((reason: WorkerFailure) => void) | null = null;
	private workerStartTimeout: number | null = null;
	private preparedPromise: Promise<void> | null = null;
	private generationChain: Promise<void> | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private unloadGeneration = 0;

	isSupported(): boolean {
		return (
			typeof window !== 'undefined' &&
			typeof Worker !== 'undefined' &&
			typeof WebAssembly !== 'undefined' &&
			typeof navigator.storage?.getDirectory === 'function'
		);
	}

	isLoaded(): boolean {
		return (
			this.worker !== null || this.workerReadyPromise !== null || this.preparedPromise !== null
		);
	}

	private resetWorker(reason: WorkerFailure): void {
		if (this.workerStartTimeout !== null) window.clearTimeout(this.workerStartTimeout);
		this.workerStartTimeout = null;
		this.workerReadyReject?.(reason);
		this.workerReadyResolve = null;
		this.workerReadyReject = null;
		this.workerReadyPromise = null;
		this.preparedPromise = null;
		for (const pending of this.pendingRequests.values()) {
			pending.abortCleanup?.();
			pending.reject(reason);
		}
		this.pendingRequests.clear();
		if (this.worker) {
			this.worker.removeEventListener('message', this.handleWorkerMessage);
			this.worker.removeEventListener('error', this.handleWorkerError);
			this.worker.terminate();
			this.worker = null;
		}
	}

	private readonly handleWorkerError = (event: ErrorEvent): void => {
		const location = event.filename
			? ` (${event.filename}:${event.lineno || 0}:${event.colno || 0})`
			: '';
		const failure =
			event.error instanceof Error
				? event.error
				: new Error(`${event.message || 'MOSS TTS worker failed.'}${location}`);
		this.resetWorker(failure);
	};

	private readonly handleWorkerMessage = (
		event: MessageEvent<WorkerReady | WorkerProgress | WorkerResponse>
	): void => {
		const payload = event.data;
		if (!payload || payload.source !== HOST_SOURCE) return;
		if (payload.type === 'ready') {
			if (this.workerStartTimeout !== null) window.clearTimeout(this.workerStartTimeout);
			this.workerStartTimeout = null;
			this.workerReadyResolve?.();
			this.workerReadyResolve = null;
			this.workerReadyReject = null;
			return;
		}
		const pending = this.pendingRequests.get(payload.requestId);
		if (!pending) return;
		if (payload.type === 'progress') {
			const message = payload.stage || `Preparing ${MODEL_LABEL}`;
			pending.onProgress?.(stageProgress(message, payload));
			return;
		}
		this.pendingRequests.delete(payload.requestId);
		pending.abortCleanup?.();
		if (payload.ok) pending.resolve(payload.data);
		else pending.reject(new Error(payload.error || 'MOSS TTS request failed.'));
	};

	private ensureWorkerLoaded(): Promise<void> {
		if (this.workerReadyPromise) return this.workerReadyPromise;
		if (!this.isSupported()) {
			return Promise.reject(new Error('Browser-managed storage is not available.'));
		}
		this.workerReadyPromise = new Promise<void>((resolve, reject) => {
			const worker = new Worker('/moss-tts/moss_tts.worker.js');
			this.worker = worker;
			this.workerReadyResolve = resolve;
			this.workerReadyReject = reject;
			worker.addEventListener('message', this.handleWorkerMessage);
			worker.addEventListener('error', this.handleWorkerError);
			this.workerStartTimeout = window.setTimeout(() => {
				if (this.worker !== worker || !this.workerReadyResolve) return;
				this.resetWorker(new Error('Timed out while starting the MOSS TTS worker.'));
			}, 30_000);
		});
		return this.workerReadyPromise;
	}

	private async requestWorker(
		action: 'warmup' | 'synthesize',
		payload: MossWorkerPayload,
		signal?: AbortSignal,
		onProgress?: (progress: LocalGenerationProgress) => void
	): Promise<WorkerResponse['data']> {
		if (signal?.aborted) throw abortError();
		await this.ensureWorkerLoaded();
		if (signal?.aborted) {
			const error = abortError();
			this.resetWorker(error);
			throw error;
		}
		if (!this.worker) throw new Error('MOSS TTS worker is not available.');
		const requestId = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			const abort = (): void => this.resetWorker(abortError());
			signal?.addEventListener('abort', abort, { once: true });
			this.pendingRequests.set(requestId, {
				resolve,
				reject,
				onProgress,
				abortCleanup: () => signal?.removeEventListener('abort', abort)
			});
			this.worker?.postMessage({
				source: CLIENT_SOURCE,
				action,
				requestId,
				threadCount: THREAD_COUNT,
				...payload
			});
		});
	}

	private ensurePrepared(
		signal?: AbortSignal,
		onProgress?: (progress: LocalGenerationProgress) => void
	): Promise<void> {
		if (!this.preparedPromise) {
			onProgress?.({
				stage: 'preparing',
				message: `Starting ${MODEL_LABEL}`,
				progress: null,
				backend: 'wasm'
			});
			this.preparedPromise = this.requestWorker('warmup', {}, signal, onProgress)
				.then(() => undefined)
				.catch((error) => {
					this.preparedPromise = null;
					throw error;
				});
		}
		return this.preparedPromise;
	}

	private async withGenerationLock<T>(task: () => Promise<T>): Promise<T> {
		const previous = this.generationChain ?? Promise.resolve();
		let release = (): void => undefined;
		const current = new Promise<void>((resolve) => (release = resolve));
		const queued = previous.then(() => current);
		this.generationChain = queued;
		await previous;
		try {
			return await task();
		} finally {
			release();
			if (this.generationChain === queued) this.generationChain = null;
		}
	}

	unload(): void {
		this.unloadGeneration += 1;
		this.resetWorker(new Error('MOSS TTS runtime was unloaded.'));
	}

	async generateSpeechFile({
		text,
		voice,
		speed,
		signal,
		onProgress
	}: MossGenerateOptions): Promise<GeneratedAudio> {
		const trimmedText = validateTtsGenerateRequest(
			text,
			this.isSupported(),
			'This browser cannot run the local MOSS TTS runtime.'
		);
		const unloadGeneration = this.unloadGeneration;
		return this.withGenerationLock(async () => {
			if (unloadGeneration !== this.unloadGeneration) throw abortError();
			if (signal?.aborted) throw abortError();
			await this.ensurePrepared(signal, onProgress);
			if (signal?.aborted) throw abortError();
			onProgress?.({
				stage: 'generating',
				message: `Generating speech with ${MODEL_LABEL}`,
				progress: null,
				backend: 'wasm'
			});
			const response = await this.requestWorker(
				'synthesize',
				{ text: trimmedText, voiceName: voice },
				signal,
				onProgress
			);
			const chunks = response?.audioChunks ?? [];
			if (chunks.length === 0) throw new Error('MOSS TTS did not return any audio.');
			const merged = mergeChunkChannels(chunks);
			if (merged.channels.length === 0 || merged.sampleRate <= 0) {
				throw new Error('MOSS TTS returned invalid audio data.');
			}
			const adjusted = applyPlaybackSpeed(merged.channels, speed);
			onProgress?.({
				stage: 'finalizing',
				message: 'Encoding voiceover',
				progress: 1,
				backend: 'wasm'
			});
			const blob = createFloat32WavBlob(adjusted, merged.sampleRate);
			return {
				blob,
				file: new File([blob], createOutputFileName(trimmedText, voice), {
					type: 'audio/wav',
					lastModified: Date.now()
				}),
				duration: audioDurationSeconds(adjusted, merged.sampleRate),
				sampleRate: merged.sampleRate
			};
		});
	}
}

export const mossTtsService = new MossTtsService();
localAiRuntimeRegistry.register({
	id: 'moss-tts',
	label: 'MOSS voices',
	isLoaded: () => mossTtsService.isLoaded(),
	unload: () => mossTtsService.unload()
});
