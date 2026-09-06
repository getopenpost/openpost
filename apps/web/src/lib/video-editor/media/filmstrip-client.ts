/**
 * Ported from FreeCut (MIT) — timeline/services/filmstrip-cache.ts,
 * trimmed to OpenPost's needs:
 * - Managed worker pool + warm preboot (kept).
 * - Memory budget with LRU eviction via SizedAccessedMemoryCache (kept;
 *   FreeCut's FilmstripMemoryState is the same shape).
 * - Idle eviction of entries with no subscribers (kept).
 * - Concurrency limits by core count + queue scored by remaining frames (kept).
 * - Throttled progressive notify (kept).
 * - OPFS frame and index persistence with ImageBitmap hydration (adapted).
 * - Viewport-exact target refinement is adapted to Svelte's shared timeline
 *   viewport rather than React's per-clip hooks.
 */

import type { MediaMetadata } from './types';
import {
	buildTargetIndices,
	FILMSTRIP_EXTRACT_HEIGHT,
	FILMSTRIP_EXTRACT_WIDTH,
	FILMSTRIP_FRAME_RATE,
	prioritizeFilmstripTargetIndices,
	type FrameRange
} from './filmstrip-plan';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';
import { createManagedWorkerPool } from './managed-worker-pool';
import type {
	FilmstripExtractRequest,
	FilmstripWorkerResponse
} from './filmstrip-extraction.worker';
import { loadFilmstrip, saveFilmstripFrame, saveFilmstripIndex } from './filmstrip-persistence';
import { removeOpfsEntry } from './opfs-cache';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';

export interface FilmstripFrame {
	index: number;
	url: string | null;
	bitmap?: ImageBitmap;
}

export interface Filmstrip {
	frames: FilmstripFrame[];
	isComplete: boolean;
	isExtracting: boolean;
	progress: number;
}

interface FilmstripCacheEntry {
	sizeBytes: number;
	lastAccessed: number;
	filmstrip: Filmstrip;
}

type FilmstripUpdateCallback = (filmstrip: Filmstrip) => void;

export interface FilmstripRequestOptions {
	priorityRange?: FrameRange;
	targetFrameIndices?: readonly number[];
	onProgress?: (progress: number) => void;
	allowExtraction?: boolean;
}

const MEMORY_SOFT_LIMIT_BYTES = 256 * 1024 * 1024;
const CACHE_EVICT_IDLE_MS = 15_000;
const PROGRESS_NOTIFY_INTERVAL_MS = 200;
const MAX_IDLE_WORKERS = 2;
const HIGH_CORE_THRESHOLD = 12;
const MAX_CONCURRENT_EXTRACTIONS_BASE = 1;
const MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE = 2;
/** Rough decoded cost of one extracted thumbnail, for LRU accounting. */
const ESTIMATED_FRAME_BYTES = FILMSTRIP_EXTRACT_WIDTH * FILMSTRIP_EXTRACT_HEIGHT * 4;

function estimatedFilmstripBytes(filmstrip: Filmstrip): number {
	return filmstrip.frames.length * ESTIMATED_FRAME_BYTES;
}

function hardwareCoreCount(): number {
	const cores = globalThis.navigator?.hardwareConcurrency;
	return cores > 0 ? cores : 4;
}

function getMaxConcurrentExtractions(): number {
	return hardwareCoreCount() >= HIGH_CORE_THRESHOLD
		? MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE
		: MAX_CONCURRENT_EXTRACTIONS_BASE;
}

class FilmstripCacheService {
	private cache = new SizedAccessedMemoryCache<FilmstripCacheEntry>(MEMORY_SOFT_LIMIT_BYTES);
	private pendingExtractions = new Map<
		string,
		{ requestId: string; targetIndices: number[]; frames: Map<number, string | null> }
	>();
	private loadingPromises = new Map<string, Promise<Filmstrip>>();
	private updateCallbacks = new Map<string, Set<FilmstripUpdateCallback>>();
	private extractionQueue: string[] = [];
	private pendingQueueStarts = new Map<string, () => void>();
	private activeExtractions = new Set<string>();
	private requestSeq = 0;
	private lastMemoryCheckAt = 0;
	private prewarmStarted = false;
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private lastNotifyAt = new Map<string, number>();
	private cacheVersions = new Map<string, number>();
	private pendingPersistence = new Map<string, Promise<void>>();
	private taskRevisions = new Map<string, number>();
	private cancelExtractions = new Map<string, () => void>();
	private cancelRequested = new Set<string>();

	private readonly workerPool = createManagedWorkerPool({
		createWorker: () =>
			new Worker(new URL('./filmstrip-extraction.worker.ts', import.meta.url), { type: 'module' }),
		resetWorker: (worker) => {
			worker.onmessage = null;
			worker.onerror = null;
		}
	});

	/** Eagerly boot one extraction worker so the first extraction skips boot latency. */
	prewarm(): void {
		if (this.prewarmStarted) return;
		this.prewarmStarted = true;
		try {
			const worker = this.workerPool.acquireWorker();
			const requestId = `warm-${++this.requestSeq}`;
			const onMessage = (event: MessageEvent<FilmstripWorkerResponse>) => {
				if (event.data.type !== 'warmed' || event.data.requestId !== requestId) return;
				worker.removeEventListener('message', onMessage);
				this.workerPool.releaseWorker(worker, { maxIdleWorkers: MAX_IDLE_WORKERS });
			};
			worker.addEventListener('message', onMessage);
			worker.postMessage({ type: 'warm', requestId });
		} catch {
			this.prewarmStarted = false;
		}
	}

	cachedFilmstrip(mediaId: string): Filmstrip | null {
		return this.cache.get(mediaId)?.filmstrip ?? null;
	}

	hasPendingExtraction(mediaId: string): boolean {
		return this.pendingExtractions.has(mediaId) || this.loadingPromises.has(mediaId);
	}

	/** Stop queued or active derived-frame work without dropping completed frames. */
	abort(mediaId: string): void {
		this.requestCancel(mediaId);
	}

	subscribe(mediaId: string, callback: FilmstripUpdateCallback): () => void {
		this.prewarm();
		this.clearIdleTimer(mediaId);
		let callbacks = this.updateCallbacks.get(mediaId);
		if (!callbacks) {
			callbacks = new Set();
			this.updateCallbacks.set(mediaId, callbacks);
		}
		callbacks.add(callback);

		const current = this.cachedFilmstrip(mediaId);
		if (current) callback(current);

		return () => {
			const set = this.updateCallbacks.get(mediaId);
			if (!set) return;
			set.delete(callback);
			if (set.size === 0) {
				this.updateCallbacks.delete(mediaId);
				this.scheduleIdleEviction(mediaId);
			}
		};
	}

	async getFilmstrip(
		media: MediaMetadata,
		options: FilmstripRequestOptions = {}
	): Promise<Filmstrip> {
		this.clearIdleTimer(media.id);

		const totalFrames = Math.max(1, Math.ceil(media.duration * FILMSTRIP_FRAME_RATE));
		const targetIndices = prioritizeFilmstripTargetIndices(
			buildTargetIndices(
				totalFrames,
				options.priorityRange ?? null,
				undefined,
				options.targetFrameIndices
			),
			options.targetFrameIndices
		);

		const loading = this.loadingPromises.get(media.id);
		if (loading) {
			return loading.then((loaded) => {
				const current = this.cachedFilmstrip(media.id) ?? loaded;
				if ((options.allowExtraction ?? true) && this.missingTargets(current, targetIndices)) {
					return this.getFilmstrip(media, options);
				}
				return current;
			});
		}

		const cached = this.cachedFilmstrip(media.id);
		if (cached?.isComplete && !this.missingTargets(cached, targetIndices)) {
			return cached;
		}

		const version = this.cacheVersions.get(media.id) ?? 0;
		const promise = this.loadPersistedOrExtract(
			media,
			targetIndices,
			options.onProgress,
			options.allowExtraction ?? true,
			version
		);
		this.loadingPromises.set(media.id, promise);
		try {
			return await promise;
		} finally {
			const current = this.loadingPromises.get(media.id);
			if (current === promise) this.loadingPromises.delete(media.id);
		}
	}

	private async loadPersistedOrExtract(
		media: MediaMetadata,
		targetIndices: number[],
		onProgress: ((progress: number) => void) | undefined,
		allowExtraction: boolean,
		version: number
	): Promise<Filmstrip> {
		const persisted = await loadFilmstrip(media.id);
		if (!this.cacheIsCurrent(media.id, version)) return emptyFilmstrip();
		if (persisted.length > 0) {
			const filmstrip: Filmstrip = {
				frames: persisted,
				isComplete: true,
				isExtracting: false,
				progress: 100
			};
			this.storeAndNotify(media.id, filmstrip, true);
			if (!this.missingTargets(filmstrip, targetIndices)) return filmstrip;
			if (!allowExtraction) return filmstrip;
		}
		if (!allowExtraction) return emptyFilmstrip();
		return this.loadAndExtract(media, targetIndices, onProgress, version);
	}

	/** Clear one media item's derived filmstrip without deleting source media. */
	async clearMedia(mediaId: string): Promise<void> {
		this.cacheVersions.set(mediaId, (this.cacheVersions.get(mediaId) ?? 0) + 1);
		this.requestCancel(mediaId);
		mediaTasks.finish(mediaTaskId('filmstrip', mediaId));
		this.dropEntry(mediaId);
		this.notifyThrottled(mediaId, emptyFilmstrip(), true);
		await this.pendingPersistence.get(mediaId)?.catch(() => undefined);
		await removeOpfsEntry('filmstrips', mediaId);
	}

	clearAll(): void {
		for (const mediaId of this.taskRevisions.keys()) {
			this.requestCancel(mediaId);
			mediaTasks.finish(mediaTaskId('filmstrip', mediaId));
		}
		for (const mediaId of this.cache.keys()) {
			this.dropEntry(mediaId);
		}
		this.cache.clear();
		for (const mediaId of [...this.idleTimers.keys()]) {
			this.clearIdleTimer(mediaId);
		}
		this.pendingExtractions.clear();
		this.loadingPromises.clear();
		this.extractionQueue = [];
		this.activeExtractions.clear();
		this.lastNotifyAt.clear();
		this.taskRevisions.clear();
		this.cancelExtractions.clear();
		this.cancelRequested.clear();
		this.workerPool.terminateAll();
		this.prewarmStarted = false;
	}

	__resetForTesting(): void {
		this.clearAll();
	}

	// ── internals ───────────────────────────────────────────────────────────

	private missingTargets(filmstrip: Filmstrip, targetIndices: number[]): boolean {
		const available = new Set(filmstrip.frames.map((frame) => frame.index));
		return targetIndices.some((index) => !available.has(index));
	}

	private async loadAndExtract(
		media: MediaMetadata,
		targetIndices: number[],
		onProgress: ((progress: number) => void) | undefined,
		version: number
	): Promise<Filmstrip> {
		const cached = this.cachedFilmstrip(media.id);
		const frames = new Map<number, string | null>();
		const bitmaps = new Map<number, ImageBitmap>();
		for (const frame of cached?.frames ?? []) {
			frames.set(frame.index, frame.url);
			if (frame.bitmap) bitmaps.set(frame.index, frame.bitmap);
		}

		const initial: Filmstrip = {
			frames: sortFrames(frames, bitmaps),
			isComplete: false,
			isExtracting: true,
			progress: cached?.progress ?? 0
		};
		this.storeAndNotify(media.id, initial, true);
		const taskId = mediaTaskId('filmstrip', media.id);
		const taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'filmstrip',
			mediaId: media.id,
			label: media.fileName,
			stage: 'queued',
			status: 'queued',
			progress: Math.max(0, Math.min(1, (cached?.progress ?? 0) / 100)),
			onCancel: () => this.requestCancel(media.id)
		});
		this.taskRevisions.set(media.id, taskRevision);

		let blob: Blob;
		try {
			blob = await resolveMediaBlobForFilmstrip(media);
		} catch (error) {
			this.finishTask(media.id, taskRevision);
			throw error;
		}
		if (this.cancelRequested.delete(media.id)) {
			this.finishTask(media.id, taskRevision);
			this.markExtractionStopped(media.id);
			throw new DOMException('Filmstrip extraction cancelled', 'AbortError');
		}

		return new Promise<Filmstrip>((resolve, reject) => {
			const requestId = `extract-${++this.requestSeq}`;
			let settled = false;
			const cancelQueued = () => {
				if (settled) return;
				settled = true;
				this.pendingQueueStarts.delete(media.id);
				this.pendingExtractions.delete(media.id);
				this.extractionQueue = this.extractionQueue.filter((id) => id !== media.id);
				this.cancelExtractions.delete(media.id);
				this.finishTask(media.id, taskRevision);
				this.markExtractionStopped(media.id);
				reject(new DOMException('Filmstrip extraction cancelled', 'AbortError'));
				this.pumpQueue();
			};
			this.pendingExtractions.set(media.id, { requestId, targetIndices, frames });
			this.cancelExtractions.set(media.id, cancelQueued);
			this.pendingQueueStarts.set(media.id, () => {
				if (settled) return;
				settled = true;
				void this.runExtraction(
					media,
					blob,
					requestId,
					targetIndices,
					frames,
					bitmaps,
					onProgress,
					version,
					taskRevision,
					resolve,
					reject
				);
			});
			if (this.cancelRequested.delete(media.id)) {
				cancelQueued();
				return;
			}
			this.enqueueExtraction(media.id);
		});
	}

	private enqueueExtraction(mediaId: string): void {
		if (this.activeExtractions.has(mediaId)) return;
		if (this.activeExtractions.size >= getMaxConcurrentExtractions()) {
			this.extractionQueue.push(mediaId);
			this.extractionQueue.sort((a, b) => this.getQueueScore(a) - this.getQueueScore(b));
			return;
		}
		const start = this.pendingQueueStarts.get(mediaId);
		if (!start) return;
		this.pendingQueueStarts.delete(mediaId);
		this.activeExtractions.add(mediaId);
		start();
	}

	private pumpQueue(): void {
		if (this.activeExtractions.size >= getMaxConcurrentExtractions()) return;
		while (this.extractionQueue.length > 0) {
			const nextMediaId = this.extractionQueue.shift();
			if (!nextMediaId) return;
			const pending = this.pendingExtractions.get(nextMediaId);
			const loading = this.pendingQueueStarts.get(nextMediaId);
			if (!pending || !loading) continue;
			this.activeExtractions.add(nextMediaId);
			loading();
			this.pendingQueueStarts.delete(nextMediaId);
			return;
		}
	}

	private getQueueScore(mediaId: string): number {
		const pending = this.pendingExtractions.get(mediaId);
		if (!pending) return Number.POSITIVE_INFINITY;
		return pending.targetIndices.length - pending.frames.size;
	}

	private async runExtraction(
		media: MediaMetadata,
		blob: Blob,
		requestId: string,
		targetIndices: number[],
		frames: Map<number, string | null>,
		bitmaps: Map<number, ImageBitmap>,
		onProgress: ((progress: number) => void) | undefined,
		version: number,
		taskRevision: number,
		resolve: (filmstrip: Filmstrip) => void,
		reject: (error: Error) => void
	): Promise<void> {
		const worker = this.workerPool.acquireWorker();
		const taskId = mediaTaskId('filmstrip', media.id);
		mediaTasks.update(taskId, { stage: 'extracting', status: 'running' }, taskRevision);
		let settled = false;

		const cleanup = (terminateWorker = false): boolean => {
			if (settled) return false;
			settled = true;
			this.finishTask(media.id, taskRevision);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
			this.pendingExtractions.delete(media.id);
			this.activeExtractions.delete(media.id);
			this.pendingQueueStarts.delete(media.id);
			this.cancelExtractions.delete(media.id);
			if (terminateWorker) this.workerPool.terminateWorker(worker);
			else this.workerPool.releaseWorker(worker, { maxIdleWorkers: MAX_IDLE_WORKERS });
			this.pumpQueue();
			return true;
		};
		const cancelActive = () => {
			if (!cleanup(true)) return;
			this.markExtractionStopped(media.id);
			reject(new DOMException('Filmstrip extraction cancelled', 'AbortError'));
		};
		this.cancelExtractions.set(media.id, cancelActive);

		const onMessage = (event: MessageEvent<FilmstripWorkerResponse>) => {
			const message = event.data;
			if (message.requestId !== requestId) return;
			const current = this.cacheIsCurrent(media.id, version);

			if (message.type === 'progress') {
				if (!current) return;
				for (const transferred of message.bitmapFrames) {
					bitmaps.get(transferred.index)?.close();
					bitmaps.set(transferred.index, transferred.bitmap);
				}
				for (const saved of message.savedFrames) {
					pendingFrameUrlRevoker(this.cache.get(media.id)?.filmstrip, saved.index);
					frames.set(saved.index, URL.createObjectURL(saved.blob));
					void this.queuePersistence(media.id, () =>
						saveFilmstripFrame(media.id, saved.index, saved.blob)
					);
				}
				onProgress?.(message.progress);
				mediaTasks.update(taskId, { progress: message.progress / 100 }, taskRevision);
				const filmstrip: Filmstrip = {
					frames: sortFrames(frames, bitmaps),
					isComplete: false,
					isExtracting: true,
					progress: message.progress
				};
				const shouldPaintFirstFrame =
					(this.cachedFilmstrip(media.id)?.frames.length ?? 0) === 0 && filmstrip.frames.length > 0;
				this.storeEntry(media.id, filmstrip);
				this.notifyThrottled(media.id, filmstrip, shouldPaintFirstFrame);
				this.enforceMemoryBudget();
				return;
			}

			if (message.type === 'complete') {
				if (!cleanup()) return;
				if (!current) {
					resolve(emptyFilmstrip());
					return;
				}
				for (const index of message.unavailableIndices ?? []) {
					frames.delete(index);
				}
				const filmstrip: Filmstrip = {
					frames: sortFrames(frames, bitmaps),
					isComplete: true,
					isExtracting: false,
					progress: 100
				};
				this.storeEntry(media.id, filmstrip);
				void this.queuePersistence(media.id, () =>
					saveFilmstripIndex(
						media.id,
						filmstrip.frames.map((frame) => frame.index)
					)
				);
				this.notifyThrottled(media.id, filmstrip, true);
				this.enforceMemoryBudget();
				resolve(filmstrip);
				return;
			}

			if (message.type === 'error') {
				if (!cleanup()) return;
				reject(new Error(message.error));
			}
		};

		const onError = (event: ErrorEvent) => {
			if (!cleanup()) return;
			reject(new Error(event.message));
		};

		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
		if (this.cancelRequested.delete(media.id)) {
			cancelActive();
			return;
		}

		const request: FilmstripExtractRequest = {
			type: 'extract',
			requestId,
			blob,
			durationSeconds: media.duration,
			targetIndices
		};
		worker.postMessage(request);
	}

	private requestCancel(mediaId: string): void {
		if (!this.taskRevisions.has(mediaId)) return;
		const cancel = this.cancelExtractions.get(mediaId);
		if (cancel) cancel();
		else this.cancelRequested.add(mediaId);
	}

	private finishTask(mediaId: string, revision: number): void {
		mediaTasks.finish(mediaTaskId('filmstrip', mediaId), revision);
		if (this.taskRevisions.get(mediaId) === revision) this.taskRevisions.delete(mediaId);
	}

	private markExtractionStopped(mediaId: string): void {
		const current = this.cachedFilmstrip(mediaId);
		if (!current) return;
		const stopped = { ...current, isExtracting: false };
		this.storeEntry(mediaId, stopped);
		this.notifyThrottled(mediaId, stopped, true);
	}

	private storeAndNotify(mediaId: string, filmstrip: Filmstrip, force: boolean): void {
		this.storeEntry(mediaId, filmstrip);
		this.notifyThrottled(mediaId, filmstrip, force);
		this.enforceMemoryBudget();
	}

	private cacheIsCurrent(mediaId: string, version: number): boolean {
		return (this.cacheVersions.get(mediaId) ?? 0) === version;
	}

	private queuePersistence(mediaId: string, write: () => Promise<void>): Promise<void> {
		const pending = this.pendingPersistence.get(mediaId) ?? Promise.resolve();
		const next = pending
			.catch(() => undefined)
			.then(write)
			.catch(() => undefined);
		this.pendingPersistence.set(mediaId, next);
		void next.then(() => {
			if (this.pendingPersistence.get(mediaId) === next) this.pendingPersistence.delete(mediaId);
		});
		return next;
	}

	private storeEntry(mediaId: string, filmstrip: Filmstrip): void {
		const previous = this.cache.get(mediaId);
		if (previous) {
			closeReplacedFrames(previous.filmstrip, filmstrip);
		}
		this.cache.add(mediaId, {
			sizeBytes: estimatedFilmstripBytes(filmstrip),
			lastAccessed: Date.now(),
			filmstrip
		});
	}

	private notifyThrottled(mediaId: string, filmstrip: Filmstrip, force = false): void {
		const now = Date.now();
		const last = this.lastNotifyAt.get(mediaId) ?? 0;
		if (!force && now - last < PROGRESS_NOTIFY_INTERVAL_MS) return;
		this.lastNotifyAt.set(mediaId, now);

		const callbacks = this.updateCallbacks.get(mediaId);
		if (callbacks) {
			for (const callback of callbacks) callback(filmstrip);
		}
	}

	private dropEntry(mediaId: string): void {
		const entry = this.cache.get(mediaId);
		if (entry) {
			revokeFrames(entry.filmstrip);
		}
		this.cache.delete(mediaId);
	}

	private enforceMemoryBudget(force = false): void {
		const now = Date.now();
		if (!force && now - this.lastMemoryCheckAt < 500) return;
		this.lastMemoryCheckAt = now;

		while (this.cache.sizeBytes > MEMORY_SOFT_LIMIT_BYTES && this.cache.keys().length > 0) {
			const evictable = this.cache
				.keys()
				.filter(
					(mediaId) => !this.hasSubscribers(mediaId) && !this.pendingExtractions.has(mediaId)
				);
			if (evictable.length === 0) break;
			// Drop the oldest-accessed evictable entry; SizedAccessedMemoryCache
			// would pick strictly-oldest overall but subscribers must survive.
			let oldestId: string | null = null;
			let oldestTime = Number.POSITIVE_INFINITY;
			for (const mediaId of evictable) {
				const accessed = this.cache.get(mediaId)?.lastAccessed ?? 0;
				if (accessed < oldestTime) {
					oldestTime = accessed;
					oldestId = mediaId;
				}
			}
			if (!oldestId) break;
			this.dropEntry(oldestId);
		}
	}

	private hasSubscribers(mediaId: string): boolean {
		const callbacks = this.updateCallbacks.get(mediaId);
		return !!callbacks && callbacks.size > 0;
	}

	private scheduleIdleEviction(mediaId: string): void {
		this.clearIdleTimer(mediaId);
		if (this.pendingExtractions.has(mediaId)) return;
		if (!this.cache.get(mediaId)) return;
		this.idleTimers.set(
			mediaId,
			setTimeout(() => {
				this.idleTimers.delete(mediaId);
				if (this.hasSubscribers(mediaId) || this.pendingExtractions.has(mediaId)) return;
				this.dropEntry(mediaId);
			}, CACHE_EVICT_IDLE_MS)
		);
	}

	private clearIdleTimer(mediaId: string): void {
		const timer = this.idleTimers.get(mediaId);
		if (timer) {
			clearTimeout(timer);
			this.idleTimers.delete(mediaId);
		}
	}
}

function emptyFilmstrip(): Filmstrip {
	return { frames: [], isComplete: false, isExtracting: false, progress: 0 };
}

async function resolveMediaBlobForFilmstrip(media: MediaMetadata): Promise<Blob> {
	const { resolveMediaBlob } = await import('./import.svelte');
	return resolveMediaBlob(media);
}

function sortFrames(
	frames: Map<number, string | null>,
	bitmaps: Map<number, ImageBitmap> = new Map()
): FilmstripFrame[] {
	return [...frames.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([index, url]) => ({ index, url, bitmap: bitmaps.get(index) }));
}

function closeReplacedFrames(previous: Filmstrip, next: Filmstrip): void {
	const retained = new Set(next.frames.map((frame) => frame.url));
	for (const frame of previous.frames) {
		if (frame.url && !retained.has(frame.url)) URL.revokeObjectURL(frame.url);
		if (frame.bitmap && !next.frames.some((candidate) => candidate.bitmap === frame.bitmap))
			frame.bitmap.close();
	}
}

function pendingFrameUrlRevoker(previous: Filmstrip | undefined, index: number): void {
	if (!previous) return;
	const frame = previous.frames.find((candidate) => candidate.index === index);
	if (frame?.url) URL.revokeObjectURL(frame.url);
	frame?.bitmap?.close();
}

function revokeFrames(filmstrip: Filmstrip): void {
	for (const frame of filmstrip.frames) {
		if (frame.url) URL.revokeObjectURL(frame.url);
		frame.bitmap?.close();
	}
}

export const filmstripCache = new FilmstripCacheService();
