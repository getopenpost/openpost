import type { ProgressInfo } from '@huggingface/transformers';
import { audioDurationSeconds, concatenateFloat32, createFloat32WavBlob } from '../audio';
import { updateDownloadProgress, type DownloadProgressCache } from '../download-progress';
import { sanitizeAiOutputFileNameSegment } from '../output-file-name';
import type { GeneratedAudio, LocalGenerationProgress } from '../types';
import { chunkTextForKokoro } from './kokoro-text';
import { validateTtsGenerateRequest } from './validation';
import { localAiRuntimeRegistry } from '../runtime-registry';

type KokoroModule = typeof import('kokoro-js');
type KokoroInstance = Awaited<ReturnType<KokoroModule['KokoroTTS']['from_pretrained']>>;
type KokoroBackend = 'webgpu' | 'wasm';

interface KokoroRuntime {
	tts: KokoroInstance;
	backend: KokoroBackend;
}

interface ParsedProgressInfo {
	file?: string;
	loaded?: number;
	total?: number;
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_DOWNLOAD_BYTES = {
	webgpu: 325_532_232,
	wasm: 92_361_116
} satisfies Record<KokoroBackend, number>;

export const KOKORO_TTS_VOICE_OPTIONS = [
	{ value: 'af_heart', label: 'Heart (US, F)' },
	{ value: 'af_bella', label: 'Bella (US, F)' },
	{ value: 'af_nicole', label: 'Nicole (US, F)' },
	{ value: 'af_sky', label: 'Sky (US, F)' },
	{ value: 'af_sarah', label: 'Sarah (US, F)' },
	{ value: 'af_alloy', label: 'Alloy (US, F)' },
	{ value: 'af_aoede', label: 'Aoede (US, F)' },
	{ value: 'af_jessica', label: 'Jessica (US, F)' },
	{ value: 'af_kore', label: 'Kore (US, F)' },
	{ value: 'af_nova', label: 'Nova (US, F)' },
	{ value: 'af_river', label: 'River (US, F)' },
	{ value: 'am_michael', label: 'Michael (US, M)' },
	{ value: 'am_fenrir', label: 'Fenrir (US, M)' },
	{ value: 'am_puck', label: 'Puck (US, M)' },
	{ value: 'am_adam', label: 'Adam (US, M)' },
	{ value: 'am_echo', label: 'Echo (US, M)' },
	{ value: 'am_eric', label: 'Eric (US, M)' },
	{ value: 'am_liam', label: 'Liam (US, M)' },
	{ value: 'am_onyx', label: 'Onyx (US, M)' },
	{ value: 'am_santa', label: 'Santa (US, M)' },
	{ value: 'bf_emma', label: 'Emma (UK, F)' },
	{ value: 'bf_isabella', label: 'Isabella (UK, F)' },
	{ value: 'bf_alice', label: 'Alice (UK, F)' },
	{ value: 'bf_lily', label: 'Lily (UK, F)' },
	{ value: 'bm_george', label: 'George (UK, M)' },
	{ value: 'bm_fable', label: 'Fable (UK, M)' },
	{ value: 'bm_lewis', label: 'Lewis (UK, M)' },
	{ value: 'bm_daniel', label: 'Daniel (UK, M)' }
] as const;

export type KokoroTtsVoice = (typeof KOKORO_TTS_VOICE_OPTIONS)[number]['value'];

export interface KokoroGenerateOptions {
	text: string;
	voice: KokoroTtsVoice;
	speed: number;
	signal?: AbortSignal;
	onProgress?: (progress: LocalGenerationProgress) => void;
}

function abortError(): DOMException {
	return new DOMException('Speech generation cancelled', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function outputFileName(text: string, voice: KokoroTtsVoice): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `ai-tts-${sanitizeAiOutputFileNameSegment(text, 'speech')}-${voice}-kokoro-${timestamp}.wav`;
}

function rawAudioChunks(audio: { audio?: unknown }): Float32Array[] | null {
	if (audio.audio instanceof Float32Array) return [audio.audio];
	if (!Array.isArray(audio.audio)) return null;
	const chunks: Float32Array[] = [];
	for (const chunk of audio.audio) {
		if (!(chunk instanceof Float32Array)) return null;
		chunks.push(chunk);
	}
	return chunks;
}

function parseProgressInfo(info: ProgressInfo): ParsedProgressInfo {
	const file = 'file' in info ? info.file : undefined;
	const loaded = 'loaded' in info ? info.loaded : undefined;
	const total = 'total' in info ? info.total : undefined;
	return {
		file: typeof file === 'string' ? file : undefined,
		loaded: typeof loaded === 'number' ? loaded : undefined,
		total: typeof total === 'number' ? total : undefined
	};
}

class KokoroTtsService {
	private modulePromise: Promise<KokoroModule> | null = null;
	private runtimePromise: Promise<KokoroRuntime> | null = null;
	private generationTail: Promise<void> = Promise.resolve();
	private unloadGeneration = 0;

	isSupported(): boolean {
		return typeof WebAssembly !== 'undefined';
	}

	isLoaded(): boolean {
		return this.runtimePromise !== null;
	}

	private async resolveBackend(): Promise<KokoroBackend> {
		if (typeof navigator === 'undefined' || !('gpu' in navigator)) return 'wasm';
		try {
			const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
			return adapter ? 'webgpu' : 'wasm';
		} catch {
			return 'wasm';
		}
	}

	private getModule(): Promise<KokoroModule> {
		this.modulePromise ??= import('kokoro-js');
		return this.modulePromise;
	}

	private ensureRuntime(
		onProgress?: (progress: LocalGenerationProgress) => void
	): Promise<KokoroRuntime> {
		if (this.runtimePromise) return this.runtimePromise;
		const downloads: DownloadProgressCache = new Map();
		this.runtimePromise = Promise.all([this.getModule(), this.resolveBackend()])
			.then(async ([module, backend]) => {
				onProgress?.({
					stage: 'downloading',
					message: 'Loading Kokoro voice model',
					progress: 0,
					backend,
					totalBytes: MODEL_DOWNLOAD_BYTES[backend]
				});
				const tts = await module.KokoroTTS.from_pretrained(MODEL_ID, {
					device: backend,
					dtype: backend === 'webgpu' ? 'fp32' : 'q8',
					progress_callback: (info: ProgressInfo) => {
						const progress = updateDownloadProgress(parseProgressInfo(info), downloads);
						if (!progress) return;
						onProgress?.({
							stage: 'downloading',
							message: 'Loading Kokoro voice model',
							progress: progress.fraction,
							backend,
							receivedBytes: progress.loaded,
							totalBytes: progress.total
						});
					}
				});
				return { tts, backend };
			})
			.catch((error) => {
				this.runtimePromise = null;
				throw error;
			});
		return this.runtimePromise;
	}

	private async withGenerationLock<T>(task: () => Promise<T>): Promise<T> {
		const previous = this.generationTail;
		let release = (): void => {};
		this.generationTail = new Promise<void>((resolve) => (release = resolve));
		await previous;
		try {
			return await task();
		} finally {
			release();
		}
	}

	async unload(): Promise<void> {
		this.unloadGeneration += 1;
		const runtimePromise = this.runtimePromise;
		this.runtimePromise = null;
		if (!runtimePromise) return;
		try {
			await this.generationTail;
			const runtime = await runtimePromise;
			await runtime.tts.model.dispose();
		} catch {
			// A failed or interrupted model load has nothing reliable to dispose.
		}
	}

	async generateSpeechFile(options: KokoroGenerateOptions): Promise<GeneratedAudio> {
		const text = validateTtsGenerateRequest(options.text, this.isSupported());
		const unloadGeneration = this.unloadGeneration;
		return this.withGenerationLock(async () => {
			if (unloadGeneration !== this.unloadGeneration) {
				throw new DOMException('Kokoro runtime was unloaded.', 'AbortError');
			}
			throwIfAborted(options.signal);
			const runtime = await this.ensureRuntime(options.onProgress);
			throwIfAborted(options.signal);
			const segments = chunkTextForKokoro(text);
			const chunks: Float32Array[] = [];
			let sampleRate = 0;

			for (const [index, segment] of segments.entries()) {
				throwIfAborted(options.signal);
				options.onProgress?.({
					stage: 'generating',
					message: `Generating speech ${index + 1} of ${segments.length}`,
					progress: index / segments.length,
					backend: runtime.backend
				});
				const audio = await runtime.tts.generate(segment, {
					voice: options.voice,
					speed: Math.min(2, Math.max(0.5, options.speed))
				});
				throwIfAborted(options.signal);
				const segmentChunks = rawAudioChunks(audio);
				if (!segmentChunks?.length) throw new Error('Kokoro returned an empty audio segment.');
				if (!sampleRate) sampleRate = audio.sampling_rate;
				chunks.push(...segmentChunks);
			}

			options.onProgress?.({
				stage: 'finalizing',
				message: 'Finalizing speech',
				progress: 1,
				backend: runtime.backend
			});
			const samples = concatenateFloat32(chunks);
			const blob = createFloat32WavBlob([samples], sampleRate);
			return {
				blob,
				file: new File([blob], outputFileName(text, options.voice), {
					type: 'audio/wav',
					lastModified: Date.now()
				}),
				duration: audioDurationSeconds([samples], sampleRate),
				sampleRate
			};
		});
	}
}

export const kokoroTtsService = new KokoroTtsService();
localAiRuntimeRegistry.register({
	id: 'kokoro-tts',
	label: 'Kokoro voices',
	isLoaded: () => kokoroTtsService.isLoaded(),
	unload: () => kokoroTtsService.unload()
});
