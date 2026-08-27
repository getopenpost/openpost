import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { resolveMediaBlob as defaultResolveMediaBlob } from '$lib/video-editor/media/resolve-media-blob';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { m } from '$lib/paraglide/messages';
import { BeatAnalyzer } from './analyzer';
import { beatsToMarkers } from './marker-mapping';
import { addBeatMarkersAtomic } from './beat-actions';
import { extractChannels } from '../channel-mix';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import type { BeatAnalysisResult, BeatDetectionConfig } from './types';

export type BeatDetectionStatus = 'idle' | 'analyzing' | 'success' | 'error' | 'cancelled';

export interface BeatDetectionProgress {
	status: BeatDetectionStatus;
	message?: string;
	createdCount?: number;
	bpm?: number;
	confidence?: number;
}

export interface BeatDetectionDependencies {
	resolveMediaBlob: (media: MediaMetadata) => Promise<Blob>;
	analyzeBlob?: (blob: Blob, signal?: AbortSignal) => Promise<BeatAnalysisResult>;
	createWorker?: () => Worker;
	beatConfig?: Partial<BeatDetectionConfig>;
}

class WorkerUnavailableError extends Error {
	constructor(cause: unknown) {
		super('Beat detection worker is unavailable', { cause });
		this.name = 'WorkerUnavailableError';
	}
}

function defaultAnalyzeBlob(blob: Blob, signal?: AbortSignal): Promise<BeatAnalysisResult> {
	const analyzer = new BeatAnalyzer();
	return analyzer.analyzeBlob(blob, signal);
}

function resolveClipId(clipId?: string | null): TimelineItem | undefined {
	if (clipId) return timelineStore.itemById.get(clipId);
	const frame = timelineStore.currentFrame;
	const candidates = timelineStore.items
		.filter((item) => item.type === 'audio' || item.type === 'video')
		.filter((item) => frame >= item.from && frame < item.from + item.durationInFrames)
		.sort((left, right) => right.from - left.from);
	if (candidates[0]) return candidates[0];
	return timelineStore.items.find((item) => item.type === 'audio' || item.type === 'video');
}

export class BeatDetectionService {
	status = $state<BeatDetectionStatus>('idle');
	error = $state<string | null>(null);
	progress = $state<string | null>(null);
	lastResult = $state<BeatDetectionProgress | null>(null);
	private controller: AbortController | null = null;
	private readonly dependencies: BeatDetectionDependencies;

	constructor(dependencies?: Partial<BeatDetectionDependencies>) {
		this.dependencies = {
			resolveMediaBlob: dependencies?.resolveMediaBlob ?? defaultResolveMediaBlob,
			analyzeBlob: dependencies?.analyzeBlob,
			createWorker: dependencies?.createWorker,
			beatConfig: dependencies?.beatConfig
		};
	}

	get isAnalyzing(): boolean {
		return this.status === 'analyzing';
	}

	cancel(): void {
		if (this.controller && this.status === 'analyzing') this.controller.abort();
	}

	reset(): void {
		this.controller?.abort();
		this.controller = null;
		this.status = 'idle';
		this.error = null;
		this.progress = null;
		this.lastResult = null;
	}

	async analyzeSelectedClip(clipId?: string | null): Promise<BeatDetectionProgress> {
		const item = resolveClipId(clipId);

		if (!item) {
			const msg =
				m.video_editor_beat_no_selection?.() ?? 'Select an audio or video clip to detect beats.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		if (item.type !== 'audio' && item.type !== 'video') {
			const msg =
				m.video_editor_beat_unsupported_clip?.() ??
				'Beat detection works on audio and video clips.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		if (!item.mediaId) {
			const msg = m.video_editor_beat_missing_media?.() ?? 'This clip has no source media.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		const media = mediaPool.get(item.mediaId);
		if (!media) {
			const msg = m.video_editor_beat_missing_media?.() ?? 'Source media not found.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		if (media.audioCodecSupported === false) {
			const msg = m.video_editor_beat_unsupported_audio?.() ?? 'This media has no decodable audio.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}

		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.status = 'analyzing';
		this.error = null;
		this.progress = m.video_editor_beat_analyzing?.() ?? 'Analyzing audio…';
		this.lastResult = { status: 'analyzing', message: this.progress };

		try {
			const blob = await this.dependencies.resolveMediaBlob(media);
			if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
			this.progress = m.video_editor_beat_decoding?.() ?? 'Decoding audio…';
			const result = await this.runAnalysis(blob, controller.signal);
			if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
			this.progress = m.video_editor_beat_mapping?.() ?? 'Placing markers…';
			const fps = timelineStore.fps;
			const markers = beatsToMarkers(result.beats, result.downbeats, { fps, item });
			const inserted = addBeatMarkersAtomic(markers);
			this.status = 'success';
			this.progress = null;
			this.lastResult = {
				status: 'success',
				createdCount: inserted,
				bpm: result.bpm,
				confidence: result.confidence,
				message:
					inserted > 0
						? (m.video_editor_beat_success?.({ count: inserted }) ??
							`Added ${inserted} beat markers.`)
						: (m.video_editor_beat_no_new_markers?.() ?? 'No new markers - beats already marked.')
			};
			return this.lastResult;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				const wasCommitted = this.status === 'success' && this.lastResult !== null;
				if (wasCommitted) return this.lastResult;
				this.status = 'cancelled';
				this.error = null;
				this.progress = null;
				this.lastResult = {
					status: 'cancelled',
					message: m.video_editor_beat_cancelled?.() ?? 'Beat detection cancelled.'
				};
				return this.lastResult;
			}
			const message =
				error instanceof Error
					? error.message
					: (m.video_editor_beat_failed?.() ?? 'Beat detection failed.');
			this.status = 'error';
			this.error = message;
			this.lastResult = { status: 'error', message };
			throw error instanceof Error ? error : new Error(message);
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	private async runAnalysis(blob: Blob, signal: AbortSignal): Promise<BeatAnalysisResult> {
		if (this.dependencies.analyzeBlob) return this.dependencies.analyzeBlob(blob, signal);
		if (this.dependencies.createWorker) {
			try {
				return await this.runViaWorker(blob, signal);
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') throw error;
				if (isWorkerAnalysisError(error)) throw error;
				if (isWorkerConstructionOrCloneError(error)) {
					const analyzer = new BeatAnalyzer(this.dependencies.beatConfig);
					return analyzer.analyzeBlob(blob, signal);
				}
				throw error;
			}
		}
		if (typeof Worker === 'undefined') {
			const analyzer = new BeatAnalyzer(this.dependencies.beatConfig);
			return analyzer.analyzeBlob(blob, signal);
		}
		try {
			return await this.runViaWorker(blob, signal);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			if (isWorkerAnalysisError(error)) throw error;
			if (isWorkerConstructionOrCloneError(error)) {
				const analyzer = new BeatAnalyzer(this.dependencies.beatConfig);
				return analyzer.analyzeBlob(blob, signal);
			}
			throw error;
		}
	}

	private async runViaWorker(blob: Blob, signal: AbortSignal): Promise<BeatAnalysisResult> {
		const arrayBuffer = await blob.arrayBuffer();
		if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
		const audioContext = new AudioContext();
		let decoded: AudioBuffer;
		try {
			decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
		} finally {
			try {
				await audioContext.close();
			} catch {
				// ignore
			}
		}
		if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
		const channels = extractChannels(decoded);
		return this.analyzeChannelsViaWorker(channels, decoded.sampleRate, decoded.duration, signal);
	}

	private analyzeChannelsViaWorker(
		channels: Float32Array[],
		sampleRate: number,
		duration: number,
		signal: AbortSignal
	): Promise<BeatAnalysisResult> {
		return new Promise<BeatAnalysisResult>((resolve, reject) => {
			let worker: Worker | null = null;
			const id = crypto.randomUUID();
			const onMessage = (
				event: MessageEvent<{
					id: string;
					ok: boolean;
					result?: BeatAnalysisResult;
					error?: string;
				}>
			) => {
				if (event.data.id !== id) return;
				cleanup();
				if (!event.data.ok) {
					reject(new Error(event.data.error ?? 'Beat detection failed'));
					return;
				}
				if (!event.data.result) {
					reject(new Error('Beat detection failed'));
					return;
				}
				resolve(event.data.result);
			};
			const onError = (event: ErrorEvent) => {
				cleanup();
				reject(new Error(event.message));
			};
			const cleanup = () => {
				if (worker) {
					worker.removeEventListener('message', onMessage);
					worker.removeEventListener('error', onError);
					worker.terminate();
					worker = null;
				}
				signal.removeEventListener('abort', onAbort);
			};
			const onAbort = () => {
				cleanup();
				reject(new DOMException('Cancelled', 'AbortError'));
			};
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) {
				onAbort();
				return;
			}
			try {
				const factory = this.dependencies.createWorker;
				worker = factory
					? factory()
					: new Worker(new URL('./beat-detection.worker.ts', import.meta.url), {
							type: 'module'
						});
			} catch (error) {
				cleanup();
				reject(new WorkerUnavailableError(error));
				return;
			}
			worker.addEventListener('message', onMessage);
			worker.addEventListener('error', onError);
			const transfer: Transferable[] = channels.map((channel) => channel.buffer);
			try {
				worker.postMessage(
					{
						id,
						channels,
						sampleRate,
						duration,
						config: this.dependencies.beatConfig
					},
					transfer
				);
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	}
}

function isWorkerAnalysisError(error: unknown): boolean {
	if (error instanceof WorkerUnavailableError) return false;
	if (error instanceof DOMException) return error.name !== 'DataCloneError';
	if (!(error instanceof Error)) return false;
	if (error.name === 'DataCloneError') return false;
	if (error.message === 'Worker construction failed') return false;
	return true;
}

function isWorkerConstructionOrCloneError(error: unknown): boolean {
	if (error instanceof WorkerUnavailableError) return true;
	if (error instanceof DOMException) return error.name === 'DataCloneError';
	if (!(error instanceof Error)) return false;
	return error.name === 'DataCloneError' || error.message === 'Worker construction failed';
}

export const beatDetectionService = new BeatDetectionService();

export function createBeatDetectionService(
	dependencies?: Partial<BeatDetectionDependencies>
): BeatDetectionService {
	return new BeatDetectionService(dependencies);
}
