import type {
	AceStepGenerationResult,
	AceStepUpdateListener,
	AceStepWebGpu,
	AudioQuality,
	CacheInventory,
	WorkerUpdate
} from 'ai-music-js';
import { gpuMediaJobScheduler } from '../../media/processing/gpu-media-job-scheduler';
import { sanitizeAiOutputFileNameSegment } from '../output-file-name';
import type { GeneratedAudio, LocalGenerationProgress } from '../types';
import { localAiRuntimeRegistry } from '../runtime-registry';

export const ACE_STEP_STANDARD_DOWNLOAD_BYTES = 5_415_546_914;
export const ACE_STEP_HIGH_DOWNLOAD_BYTES = 7_793_145_257;
export const ACE_STEP_MIN_DURATION_SECONDS = 2;
export const ACE_STEP_MAX_DURATION_SECONDS = 120;
const ACE_STEP_MODEL_MIN_DURATION_SECONDS = 10;
const TURBO_UNUSED_ASSET_GROUP = 'audio-code-detokenizer';

export interface MusicGenerationSupport {
	supported: boolean;
	reason?: 'desktop-chromium-required' | 'secure-context-required' | 'webgpu-unavailable';
}

export interface MusicGenerationStorageStatus {
	expectedBytes: number;
	readyBytes: number;
	missingBytes: number;
	headroomBytes: number;
	availableBytes?: number;
	effectiveAvailableBytes?: number;
	sufficient: boolean;
	persisted?: boolean;
}

export interface GenerateLocalMusicOptions {
	prompt: string;
	durationSeconds: number;
	audioQuality: AudioQuality;
	seed?: number;
	signal?: AbortSignal;
	onProgress?: (progress: LocalGenerationProgress) => void;
}

export interface GeneratedMusic extends GeneratedAudio {
	seed: number;
	model: 'ace-step-1.5-xl-turbo';
	audioQuality: AudioQuality;
	prompt: string;
}

export type AceStepRuntime = Pick<
	AceStepWebGpu,
	'generate' | 'subscribe' | 'cancel' | 'dispose' | 'listCachedModels' | 'clearCache'
>;

type RuntimeFactory = (listener: AceStepUpdateListener) => Promise<AceStepRuntime>;

function isMobileBrowser(): boolean {
	return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

export async function inspectMusicGenerationSupport(): Promise<MusicGenerationSupport> {
	if (typeof window === 'undefined' || typeof Worker === 'undefined' || isMobileBrowser()) {
		return { supported: false, reason: 'desktop-chromium-required' };
	}
	if (!window.isSecureContext && location.hostname !== 'localhost') {
		return { supported: false, reason: 'secure-context-required' };
	}
	if (!('gpu' in navigator)) return { supported: false, reason: 'webgpu-unavailable' };
	try {
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		return adapter ? { supported: true } : { supported: false, reason: 'webgpu-unavailable' };
	} catch {
		return { supported: false, reason: 'webgpu-unavailable' };
	}
}

function stageFromUpdate(update: WorkerUpdate): LocalGenerationProgress['stage'] {
	if (update.type === 'download') return 'downloading';
	if (update.type !== 'progress') return 'preparing';
	if (/packaging|complete/i.test(update.stage)) return 'finalizing';
	if (/starting|compatibility|tokenization|model/i.test(update.stage)) return 'preparing';
	return 'generating';
}

function progressMessage(update: WorkerUpdate): string {
	if (update.type === 'download') return `Downloading ${update.label}`;
	if (update.type === 'progress') return update.detail || update.stage.replaceAll('-', ' ');
	if (update.type === 'stage') return update.detail || update.stage.replaceAll('-', ' ');
	return 'Preparing ACE-Step';
}

function chunkId(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(
		bytes[offset] ?? 0,
		bytes[offset + 1] ?? 0,
		bytes[offset + 2] ?? 0,
		bytes[offset + 3] ?? 0
	);
}

/** Trim a PCM or float WAV at a whole sample frame without decoding or changing its samples. */
export async function trimGeneratedWav(blob: Blob, durationSeconds: number): Promise<Blob> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	if (bytes.length < 44 || chunkId(bytes, 0) !== 'RIFF' || chunkId(bytes, 8) !== 'WAVE') {
		throw new Error('ACE-Step returned an invalid WAV file.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 12;
	let sampleRate = 0;
	let blockAlign = 0;
	let dataHeader = -1;
	let dataOffset = -1;
	let dataSize = 0;
	while (offset + 8 <= bytes.length) {
		const id = chunkId(bytes, offset);
		const size = view.getUint32(offset + 4, true);
		const payload = offset + 8;
		if (payload + size > bytes.length) throw new Error('ACE-Step returned a truncated WAV file.');
		if (id === 'fmt ' && size >= 16) {
			sampleRate = view.getUint32(payload + 4, true);
			blockAlign = view.getUint16(payload + 12, true);
		} else if (id === 'data') {
			dataHeader = offset;
			dataOffset = payload;
			dataSize = size;
			break;
		}
		offset = payload + size + (size % 2);
	}
	if (sampleRate <= 0 || blockAlign <= 0 || dataOffset < 0 || dataHeader < 0) {
		throw new Error('ACE-Step returned a WAV without a usable audio stream.');
	}
	const requestedFrames = Math.max(1, Math.floor(durationSeconds * sampleRate));
	const trimmedSize = Math.min(dataSize, requestedFrames * blockAlign);
	if (trimmedSize >= dataSize) return blob;
	const output = bytes.slice(0, dataOffset + trimmedSize);
	const outputView = new DataView(output.buffer, output.byteOffset, output.byteLength);
	outputView.setUint32(dataHeader + 4, trimmedSize, true);
	outputView.setUint32(4, output.length - 8, true);
	return new Blob([output], { type: 'audio/wav' });
}

export class AceStepMusicService {
	private runtime: AceStepRuntime | null = null;
	private runtimePromise: Promise<AceStepRuntime> | null = null;
	private generationTail: Promise<void> = Promise.resolve();
	private activeAbort: AbortController | null = null;
	private runtimeGeneration = 0;
	private unloadGeneration = 0;

	constructor(
		private readonly createRuntime: RuntimeFactory = AceStepMusicService.defaultRuntime
	) {}

	private static async defaultRuntime(listener: AceStepUpdateListener): Promise<AceStepRuntime> {
		const [module, workerAsset, languageWorkerAsset, wasmAsset, wasmModuleAsset] =
			await Promise.all([
				import('ai-music-js'),
				import('ai-music-js/worker?url'),
				import('ai-music-js/language-worker?url'),
				import('ai-music-js/wasm/ort-wasm-simd-threaded.asyncify.wasm?url'),
				import('ai-music-js/wasm/ort-wasm-simd-threaded.asyncify.mjs?url')
			]);
		return new module.AceStepWebGpu({
			workerUrl: workerAsset.default,
			languageWorkerUrl: languageWorkerAsset.default,
			wasmUrl: wasmAsset.default,
			wasmModuleUrl: wasmModuleAsset.default,
			allowWasmFallback: false,
			onUpdate: listener
		});
	}

	private ensureRuntime(): Promise<AceStepRuntime> {
		if (this.runtime) {
			return Promise.resolve(this.runtime);
		}
		if (!this.runtimePromise) {
			const generation = ++this.runtimeGeneration;
			this.runtimePromise = this.createRuntime(() => undefined)
				.then((runtime) => {
					if (generation !== this.runtimeGeneration) {
						runtime.dispose();
						throw new DOMException('ACE-Step runtime was unloaded.', 'AbortError');
					}
					this.runtime = runtime;
					return runtime;
				})
				.finally(() => {
					this.runtimePromise = null;
				});
		}
		return this.runtimePromise;
	}

	isLoaded(): boolean {
		return this.runtime !== null || this.runtimePromise !== null || this.activeAbort !== null;
	}

	async generate(options: GenerateLocalMusicOptions): Promise<GeneratedMusic> {
		const prompt = options.prompt.trim();
		if (!prompt) throw new TypeError('Describe the music you want to create.');
		if (
			!Number.isInteger(options.durationSeconds) ||
			options.durationSeconds < ACE_STEP_MIN_DURATION_SECONDS ||
			options.durationSeconds > ACE_STEP_MAX_DURATION_SECONDS
		) {
			throw new RangeError(
				`Duration must be a whole number from ${ACE_STEP_MIN_DURATION_SECONDS} to ${ACE_STEP_MAX_DURATION_SECONDS} seconds.`
			);
		}
		const previous = this.generationTail;
		const unloadGeneration = this.unloadGeneration;
		let releaseTurn!: () => void;
		this.generationTail = new Promise<void>((resolve) => {
			releaseTurn = resolve;
		});
		await previous;
		const abort = new AbortController();
		this.activeAbort = abort;
		const forwardAbort = () => abort.abort();
		options.signal?.addEventListener('abort', forwardAbort, { once: true });
		if (options.signal?.aborted) abort.abort();
		let releaseGpu: (() => void) | undefined;
		let unsubscribe: (() => void) | undefined;
		const downloads = new Map<string, number>();
		const totalBytes =
			options.audioQuality === 'high'
				? ACE_STEP_HIGH_DOWNLOAD_BYTES
				: ACE_STEP_STANDARD_DOWNLOAD_BYTES;
		const listener: AceStepUpdateListener = (update) => {
			if (update.type === 'download')
				downloads.set(update.assetId, Math.min(update.loaded, update.total));
			if (update.type !== 'download' && update.type !== 'progress' && update.type !== 'stage')
				return;
			const receivedBytes = Math.min(
				totalBytes,
				[...downloads.values()].reduce((sum, value) => sum + value, 0)
			);
			const nextProgress: LocalGenerationProgress = {
				stage: stageFromUpdate(update),
				message: progressMessage(update),
				progress: update.type === 'progress' ? update.progress : null,
				backend: 'webgpu'
			};
			if (receivedBytes > 0) {
				nextProgress.receivedBytes = receivedBytes;
				nextProgress.totalBytes = totalBytes;
			}
			options.onProgress?.(nextProgress);
		};
		try {
			if (unloadGeneration !== this.unloadGeneration) {
				throw new DOMException('ACE-Step runtime was unloaded.', 'AbortError');
			}
			releaseGpu = await gpuMediaJobScheduler.acquire(abort.signal);
			options.onProgress?.({
				stage: 'preparing',
				message: 'Preparing ACE-Step',
				progress: 0,
				backend: 'webgpu',
				totalBytes
			});
			const runtime = await this.ensureRuntime();
			unsubscribe = runtime.subscribe(listener);
			const seed = options.seed ?? crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
			const renderDurationSeconds = Math.max(
				ACE_STEP_MODEL_MIN_DURATION_SECONDS,
				options.durationSeconds
			);
			const result: AceStepGenerationResult = await runtime.generate({
				prompt,
				durationSeconds: renderDurationSeconds,
				audioQuality: options.audioQuality,
				plannerQuality: 'turbo',
				seed,
				sampler: 'euler',
				allowWasmFallback: false,
				signal: abort.signal
			});
			const wav =
				options.durationSeconds < result.durationSeconds
					? await trimGeneratedWav(result.wav, options.durationSeconds)
					: result.wav;
			const fileName = `ai-music-${sanitizeAiOutputFileNameSegment(prompt, 'track')}-${seed}.wav`;
			const file = new File([wav], fileName, { type: 'audio/wav' });
			return {
				blob: wav,
				file,
				duration: Math.min(options.durationSeconds, result.durationSeconds),
				sampleRate: result.sampleRate,
				seed,
				model: 'ace-step-1.5-xl-turbo',
				audioQuality: options.audioQuality,
				prompt
			};
		} finally {
			unsubscribe?.();
			releaseGpu?.();
			options.signal?.removeEventListener('abort', forwardAbort);
			if (this.activeAbort === abort) this.activeAbort = null;
			releaseTurn();
		}
	}

	cancel(): boolean {
		if (!this.activeAbort) return false;
		this.activeAbort.abort();
		this.runtime?.cancel();
		return true;
	}

	async inspectCache(signal?: AbortSignal): Promise<CacheInventory> {
		const runtime = await this.ensureRuntime();
		return runtime.listCachedModels(signal);
	}

	async inspectGenerationStorage(
		audioQuality: AudioQuality,
		signal?: AbortSignal
	): Promise<MusicGenerationStorageStatus> {
		const [module, inventory] = await Promise.all([
			import('ai-music-js'),
			this.inspectCache(signal)
		]);
		const required = module
			.getRequiredAssets({ audioQuality })
			.filter((asset) => asset.group !== TURBO_UNUSED_ASSET_GROUP);
		const cachedAssets = new Map(
			inventory.models.flatMap((model) => model.assets).map((asset) => [asset.id, asset])
		);
		let readyBytes = 0;
		let partialBytes = 0;
		for (const asset of required) {
			const cached = cachedAssets.get(asset.id);
			if (cached?.cached) readyBytes += asset.bytes;
			else partialBytes += Math.min(cached?.storedBytes ?? 0, asset.bytes);
		}
		const expectedBytes = required.reduce((sum, asset) => sum + asset.bytes, 0);
		const missingBytes = Math.max(0, expectedBytes - readyBytes);
		const headroomBytes =
			missingBytes > 0 ? Math.max(512_000_000, Math.ceil(missingBytes * 0.05)) : 0;
		const effectiveAvailableBytes =
			inventory.availableBytes === undefined ? undefined : inventory.availableBytes + partialBytes;
		return {
			expectedBytes,
			readyBytes,
			missingBytes,
			headroomBytes,
			availableBytes: inventory.availableBytes,
			effectiveAvailableBytes,
			sufficient:
				effectiveAvailableBytes === undefined ||
				effectiveAvailableBytes >= missingBytes + headroomBytes,
			persisted: inventory.persisted
		};
	}

	async clearCache(signal?: AbortSignal): Promise<boolean> {
		this.unloadGeneration += 1;
		this.cancel();
		await this.generationTail;
		try {
			const runtime = await this.ensureRuntime();
			const inventory = await runtime.listCachedModels(signal);
			if (inventory.storedBytes === 0) return false;
			await runtime.clearCache(signal);
			return true;
		} finally {
			this.unload();
		}
	}

	unload(): void {
		this.unloadGeneration += 1;
		this.cancel();
		this.runtimeGeneration += 1;
		this.runtime?.dispose();
		this.runtime = null;
		this.runtimePromise = null;
	}
}

export const aceStepMusicService = new AceStepMusicService();
localAiRuntimeRegistry.register({
	id: 'ace-step-music',
	label: 'ACE-Step music',
	isLoaded: () => aceStepMusicService.isLoaded(),
	unload: () => aceStepMusicService.unload()
});

export function inspectMusicGenerationStorage(
	audioQuality: AudioQuality,
	signal?: AbortSignal
): Promise<MusicGenerationStorageStatus> {
	return aceStepMusicService.inspectGenerationStorage(audioQuality, signal);
}

export function generateLocalMusic(options: GenerateLocalMusicOptions): Promise<GeneratedMusic> {
	return aceStepMusicService.generate(options);
}

export function musicGenerationTags(result: GeneratedMusic): string[] {
	return [
		'ai-generated',
		'music',
		'ace-step',
		`ace-step-quality:${result.audioQuality}`,
		`ace-step-seed:${result.seed}`
	];
}
