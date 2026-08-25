/**
 * Animated image frame cache: extraction, memory budget, persistence.
 *
 * Ported from FreeCut (MIT) - timeline/services/gif-frame-cache.ts, adapted to
 * OpenPost's worker + OPFS architecture (filmstrip-client.ts shape):
 * - All decode work happens in one dedicated worker via WebCodecs
 *   ImageDecoder; frames stream back progressively as transferred bitmaps.
 * - A size-bounded LRU (SizedAccessedMemoryCache) caps decoded memory.
 * - Frames and exact per-frame delays persist to OPFS so a reload restores
 *   animations without re-decoding.
 * - Extraction is single-flight per media id, cancellable, and reported as a
 *   cancellable media task with progress.
 */

import type { MediaMetadata } from './types';
import { computeCumulativeDelays } from './animated-image-plan';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';
import type { AnimatedImageWorkerResponse } from './animated-image-extraction.worker';
import {
	loadAnimatedImage,
	removeAnimatedImage,
	saveAnimatedImageFrame,
	saveAnimatedImageMeta
} from './animated-image-persistence';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';
import { createLogger } from '../workspace-fs/logger';

const logger = createLogger('AnimatedImageCache');

const MEMORY_SOFT_LIMIT_BYTES = 128 * 1024 * 1024;

export interface AnimatedImageFrames {
	mediaId: string;
	/** Index-aligned composited frames. */
	frames: ImageBitmap[];
	/** Exact per-frame delay in milliseconds, straight from the container. */
	durationsMs: number[];
	cumulativeDelaysMs: number[];
	totalDurationMs: number;
	width: number;
	height: number;
	isComplete: boolean;
}

interface CacheEntry {
	sizeBytes: number;
	lastAccessed: number;
	frames: AnimatedImageFrames;
}

type UpdateCallback = (frames: AnimatedImageFrames) => void;

function estimateBytes(frames: AnimatedImageFrames): number {
	return Math.max(1, frames.width) * Math.max(1, frames.height) * frames.frames.length * 4;
}

function finalize(
	partial: Pick<
		AnimatedImageFrames,
		'mediaId' | 'frames' | 'durationsMs' | 'width' | 'height' | 'isComplete'
	>
): AnimatedImageFrames {
	const cumulativeDelaysMs = computeCumulativeDelays(partial.durationsMs);
	return {
		mediaId: partial.mediaId,
		frames: partial.frames,
		durationsMs: partial.durationsMs,
		cumulativeDelaysMs,
		totalDurationMs: cumulativeDelaysMs[cumulativeDelaysMs.length - 1] ?? 0,
		width: partial.width,
		height: partial.height,
		isComplete: partial.isComplete
	};
}

class AnimatedImageCacheService {
	private cache = new SizedAccessedMemoryCache<CacheEntry>(MEMORY_SOFT_LIMIT_BYTES);
	private loadingPromises = new Map<string, Promise<AnimatedImageFrames>>();
	private updateCallbacks = new Map<string, Set<UpdateCallback>>();
	private taskRevisions = new Map<string, number>();
	private pendingPersistence = new Map<string, Promise<void>>();
	private activeRequestIds = new Map<string, string>();
	private requestSeq = 0;
	private worker: Worker | null = null;

	private getExtractor(): Worker | null {
		if (this.worker) return this.worker;
		try {
			this.worker = new Worker(new URL('./animated-image-extraction.worker.ts', import.meta.url), {
				type: 'module'
			});
			this.worker.onerror = () => undefined;
			return this.worker;
		} catch {
			return null;
		}
	}

	cachedFrames(mediaId: string): AnimatedImageFrames | null {
		return this.cache.get(mediaId)?.frames ?? null;
	}

	subscribe(mediaId: string, callback: UpdateCallback): () => void {
		let callbacks = this.updateCallbacks.get(mediaId);
		if (!callbacks) {
			callbacks = new Set();
			this.updateCallbacks.set(mediaId, callbacks);
		}
		callbacks.add(callback);
		const current = this.cachedFrames(mediaId);
		if (current) callback(current);
		return () => {
			const set = this.updateCallbacks.get(mediaId);
			if (!set) return;
			set.delete(callback);
			if (set.size === 0) this.updateCallbacks.delete(mediaId);
		};
	}

	async getAnimatedImage(
		media: MediaMetadata,
		options: { onProgress?: (progress: number) => void } = {}
	): Promise<AnimatedImageFrames> {
		const cached = this.cachedFrames(media.id);
		if (cached?.isComplete) return cached;

		const loading = this.loadingPromises.get(media.id);
		if (loading) return loading;

		const promise = this.loadOrExtract(media, options).finally(() => {
			if (this.loadingPromises.get(media.id) === promise) this.loadingPromises.delete(media.id);
		});
		this.loadingPromises.set(media.id, promise);
		return promise;
	}

	/** Stop queued or running extraction without dropping completed frames. */
	abort(mediaId: string): void {
		const requestId = this.activeRequestIds.get(mediaId);
		if (!requestId || !this.worker) return;
		this.worker.postMessage({ type: 'abort', requestId });
	}

	/** Drop one media item's decoded frames and persisted cache. */
	clearMedia(mediaId: string): Promise<void> {
		this.abort(mediaId);
		const entry = this.cache.get(mediaId);
		if (entry) {
			for (const bitmap of entry.frames.frames) bitmap.close();
			this.cache.delete(mediaId);
		}
		this.loadingPromises.delete(mediaId);
		return removeAnimatedImage(mediaId).catch(() => undefined);
	}

	__resetForTesting(): void {
		for (const entry of [...this.cache.keys()]) void this.clearMedia(entry);
		this.cache.clear();
		this.loadingPromises.clear();
		this.updateCallbacks.clear();
		this.taskRevisions.clear();
		this.pendingPersistence.clear();
		this.activeRequestIds.clear();
		this.worker?.terminate();
		this.worker = null;
	}

	// ── internals ───────────────────────────────────────────────────────────

	private async loadOrExtract(
		media: MediaMetadata,
		options: { onProgress?: (progress: number) => void }
	): Promise<AnimatedImageFrames> {
		const persisted = await loadAnimatedImage(media.id).catch(() => null);
		if (persisted && persisted.frames.length === persisted.durationsMs.length) {
			const restored = finalize({
				mediaId: media.id,
				frames: persisted.frames,
				durationsMs: persisted.durationsMs,
				width: persisted.width,
				height: persisted.height,
				isComplete: true
			});
			this.storeAndNotify(restored);
			return restored;
		}

		const taskId = mediaTaskId('animated-image', media.id);
		const taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'animated-image',
			mediaId: media.id,
			label: media.fileName,
			stage: 'extracting',
			status: 'running',
			progress: 0,
			onCancel: () => this.abort(media.id)
		});
		this.taskRevisions.set(media.id, taskRevision);

		try {
			const blob = await resolveMediaBlobForExtraction(media);
			const result = await this.runExtraction(media, blob, {
				onFrame: (index, totalKnown, bitmap) => {
					options.onProgress?.(Math.round(((index + 1) / totalKnown) * 100));
				},
				onSaved: (index, encoded) => {
					void this.queuePersistence(media.id, () =>
						saveAnimatedImageFrame(media.id, index, encoded)
					);
				}
			});
			const frames = result.frames;
			const complete = finalize({
				mediaId: media.id,
				frames,
				durationsMs: result.durationsMs,
				width: result.width,
				height: result.height,
				isComplete: true
			});
			this.storeAndNotify(complete);
			// Completion implies durability: wait for the trailing meta write so a
			// caller that finishes extracting can reload from cache immediately.
			await this.queuePersistence(media.id, () =>
				saveAnimatedImageMeta(media.id, {
					durationsMs: result.durationsMs,
					width: result.width,
					height: result.height,
					frameCount: frames.length
				})
			);
			return complete;
		} catch (error) {
			logger.warn(`Animated image extraction failed for ${media.fileName}`, error);
			throw error;
		} finally {
			mediaTasks.finish(taskId, taskRevision);
			if (this.taskRevisions.get(media.id) === taskRevision) this.taskRevisions.delete(media.id);
		}
	}

	private runExtraction(
		media: MediaMetadata,
		blob: Blob,
		handlers: {
			onFrame: (index: number, frameCount: number, bitmap: ImageBitmap) => void;
			onSaved: (index: number, blob: Blob) => void;
		}
	): Promise<{
		frames: ImageBitmap[];
		durationsMs: number[];
		width: number;
		height: number;
	}> {
		const extractor = this.getExtractor();
		if (!extractor) {
			return Promise.reject(new Error('This browser cannot decode animated images.'));
		}
		const requestId = `${media.id}:${++this.requestSeq}`;
		this.activeRequestIds.set(media.id, requestId);

		return new Promise((resolve, reject) => {
			const frames: ImageBitmap[] = [];
			let durationsMs: number[] = [];
			let width = 0;
			let height = 0;
			const finish = (): void => {
				extractor.removeEventListener('message', onMessage);
				if (this.activeRequestIds.get(media.id) === requestId) {
					this.activeRequestIds.delete(media.id);
				}
			};
			const onMessage = (event: MessageEvent<AnimatedImageWorkerResponse>) => {
				const message = event.data;
				if (message.requestId !== requestId) return;
				if (message.type === 'progress') {
					for (const frame of message.frames) {
						frames[frame.index] = frame.bitmap;
						handlers.onFrame(frame.index, media.animationFrameCount ?? 0, frame.bitmap);
					}
					for (const saved of message.savedFrames) handlers.onSaved(saved.index, saved.blob);
					return;
				}
				finish();
				if (message.type === 'complete') {
					durationsMs = message.durationsMs;
					width = message.width;
					height = message.height;
					resolve({ frames, durationsMs, width, height });
				} else {
					reject(new Error(message.error));
				}
			};
			extractor.addEventListener('message', onMessage);
			extractor.postMessage({ type: 'extract', requestId, blob, mimeType: media.mimeType });
		});
	}

	private storeAndNotify(frames: AnimatedImageFrames): void {
		const previous = this.cache.get(frames.mediaId);
		if (previous && previous.frames !== frames) {
			for (const [index, bitmap] of previous.frames.frames.entries()) {
				if (bitmap !== frames.frames[index] && !frames.frames.includes(bitmap)) bitmap.close();
			}
		}
		this.cache.add(frames.mediaId, {
			sizeBytes: estimateBytes(frames),
			lastAccessed: Date.now(),
			frames
		});
		const callbacks = this.updateCallbacks.get(frames.mediaId);
		if (callbacks) {
			for (const callback of callbacks) callback(frames);
		}
	}

	private queuePersistence(mediaId: string, write: () => Promise<void>): Promise<void> {
		const pending = this.pendingPersistence.get(mediaId) ?? Promise.resolve();
		const next = pending.catch(() => undefined).then(write).catch(() => undefined);
		this.pendingPersistence.set(mediaId, next);
		void next.then(() => {
			if (this.pendingPersistence.get(mediaId) === next) this.pendingPersistence.delete(mediaId);
		});
		return next;
	}
}

async function resolveMediaBlobForExtraction(media: MediaMetadata): Promise<Blob> {
	const { resolveMediaBlob } = await import('./import.svelte');
	return resolveMediaBlob(media);
}

export const animatedImageCache = new AnimatedImageCacheService();
