/**
 * Proxy media client. Generates and caches low-res proxy blobs per mediaId
 * so scrubbing large footage stays smooth. Mirrors the waveform-client
 * architecture: in-memory cache, inflight dedup, lazy import of
 * resolveMediaBlob, one worker per generation run.
 *
 * Memory tier ported from FreeCut (MIT): a size-bounded
 * least-recently-accessed cache replaces the unbounded Map.
 */

import { startProfileSpan } from '$lib/performance/profiling';
import type { MediaMetadata } from './types';
import type { ProxyRequest, ProxyWorkerResponse } from './proxy-worker';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';

export const PROXY_MAX_HEIGHT = 540;
export const PROXY_BITRATE = 1_000_000;

interface ProxyCacheEntry {
	blob: Blob | null;
	sizeBytes: number;
	lastAccessed: number;
}

const cache = new SizedAccessedMemoryCache<ProxyCacheEntry>(128 * 1024 * 1024);
interface ProxyJob {
	controller: AbortController;
	promise: Promise<Blob>;
	waiters: Map<symbol, ((progress: number) => void) | undefined>;
}

const inflight = new Map<string, ProxyJob>();
const automaticInflight = new Map<string, ProxyJob>();
let automaticQueue: Promise<void> = Promise.resolve();

export interface ProxyDimensions {
	width: number;
	height: number;
}

/**
 * Keep ordinary HD clips on their source. Auto proxies target footage that is
 * costly to decode or seek, while the Full setting remains an explicit escape
 * hatch for machines that handle the source well.
 */
export function isAutomaticProxyCandidate(media: MediaMetadata): boolean {
	if (!media.mimeType.startsWith('video/')) return false;
	return (
		media.width > 1920 ||
		media.height > 1080 ||
		media.fps > 30 ||
		media.bitrate >= 12_000_000 ||
		media.fileSize >= 512 * 1024 * 1024 ||
		media.videoCodecSupported === false
	);
}

/** Compatibility proxies stay mandatory even when the user requests Full preview quality. */
export function shouldUseAutomaticProxy(
	media: MediaMetadata,
	previewQuality: 'auto' | 'full'
): boolean {
	if (media.videoCodecSupported === false) return true;
	return previewQuality === 'auto' && isAutomaticProxyCandidate(media);
}

/**
 * Pure sizing math: cap height at `maxHeight`, preserve aspect ratio, and
 * keep even dimensions (a codec requirement for VP9).
 */
export function proxyDimensions(
	width: number,
	height: number,
	maxHeight: number = PROXY_MAX_HEIGHT
): ProxyDimensions {
	if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
	const scale = Math.min(1, maxHeight / height);
	let nextWidth = Math.max(2, Math.round(width * scale));
	let nextHeight = Math.max(2, Math.round(height * scale));
	nextWidth -= nextWidth % 2;
	nextHeight -= nextHeight % 2;
	return { width: nextWidth, height: nextHeight };
}

/** The cached proxy blob for a media id, if one has been generated. */
export function cachedProxy(mediaId: string): Blob | null {
	return cache.get(mediaId)?.blob ?? null;
}

export async function getProxy(
	media: MediaMetadata,
	onProgress?: (progress: number) => void,
	signal?: AbortSignal
): Promise<Blob> {
	if (signal?.aborted) throw new DOMException('Proxy generation aborted', 'AbortError');
	const existing = cache.get(media.id);
	if (existing?.blob) return existing.blob;
	let job = inflight.get(media.id);
	if (!job || job.controller.signal.aborted) {
		const controller = new AbortController();
		const waiters: ProxyJob['waiters'] = new Map();
		const promise = encodeProxy(
			media,
			(progress) => {
				for (const report of waiters.values()) report?.(progress);
			},
			controller.signal
		).finally(() => {
			if (inflight.get(media.id)?.controller === controller) inflight.delete(media.id);
		});
		job = { controller, promise, waiters };
		inflight.set(media.id, job);
	}
	return waitForProxy(job, onProgress, signal);
}

/** Serialize background proxy work so heavy clips do not compete for decoders. */
export function getAutomaticProxy(
	media: MediaMetadata,
	onProgress?: (progress: number) => void,
	signal?: AbortSignal
): Promise<Blob> {
	if (signal?.aborted) {
		return Promise.reject(new DOMException('Proxy generation aborted', 'AbortError'));
	}
	const existing = cache.get(media.id);
	if (existing?.blob) return Promise.resolve(existing.blob);
	const pending = automaticInflight.get(media.id);
	const job =
		pending && !pending.controller.signal.aborted ? pending : startAutomaticProxyJob(media);
	return waitForProxy(job, onProgress, signal);
}

function startAutomaticProxyJob(media: MediaMetadata): ProxyJob {
	const taskId = mediaTaskId('proxy', media.id);
	const taskController = new AbortController();
	const waiters = new Map<symbol, ((progress: number) => void) | undefined>();
	const taskRevision = mediaTasks.start({
		id: taskId,
		kind: 'proxy',
		mediaId: media.id,
		label: media.fileName,
		stage: 'queued',
		status: 'queued',
		progress: 0,
		onCancel: () => taskController.abort()
	});
	const onAbort = () => mediaTasks.finish(taskId, taskRevision);
	taskController.signal.addEventListener('abort', onAbort, { once: true });
	const request = automaticQueue
		.catch(() => undefined)
		.then(() => {
			if (taskController.signal.aborted) {
				throw new DOMException('Proxy generation aborted', 'AbortError');
			}
			mediaTasks.update(taskId, { stage: 'encoding', status: 'running' }, taskRevision);
			return getProxy(
				media,
				(progress) => {
					mediaTasks.update(taskId, { progress }, taskRevision);
					for (const onProgress of waiters.values()) onProgress?.(progress);
				},
				taskController.signal
			);
		})
		.finally(() => {
			taskController.signal.removeEventListener('abort', onAbort);
			if (automaticInflight.get(media.id)?.promise === request) {
				automaticInflight.delete(media.id);
			}
			mediaTasks.finish(taskId, taskRevision);
		});
	const job: ProxyJob = { controller: taskController, promise: request, waiters };
	automaticInflight.set(media.id, job);
	automaticQueue = request.then(
		() => undefined,
		() => undefined
	);
	return job;
}

function waitForProxy(
	job: ProxyJob,
	onProgress?: (progress: number) => void,
	signal?: AbortSignal
): Promise<Blob> {
	const waiter = Symbol('proxy-waiter');
	job.waiters.set(waiter, onProgress);
	return new Promise((resolve, reject) => {
		const release = () => {
			job.waiters.delete(waiter);
			signal?.removeEventListener('abort', abort);
			job.controller.signal.removeEventListener('abort', onJobAbort);
		};
		const onJobAbort = () => {
			release();
			reject(new DOMException('Proxy generation aborted', 'AbortError'));
		};
		const abort = () => {
			onJobAbort();
			if (job.waiters.size === 0) job.controller.abort();
		};
		signal?.addEventListener('abort', abort, { once: true });
		job.controller.signal.addEventListener('abort', onJobAbort, { once: true });
		if (signal?.aborted) abort();
		else if (job.controller.signal.aborted) onJobAbort();
		job.promise.then(
			(blob) => {
				release();
				resolve(blob);
			},
			(error) => {
				release();
				reject(error);
			}
		);
	});
}

function encodeProxy(
	media: MediaMetadata,
	onProgress: (progress: number) => void,
	signal: AbortSignal
): Promise<Blob> {
	const finishProfile = startProfileSpan('Media', 'Generate proxy');
	return new Promise<Blob>((resolve, reject) => {
		let worker: Worker | undefined;
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			if (worker) {
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				worker.terminate();
			}
			finishProfile?.();
			callback();
		};
		const abort = () =>
			finish(() => reject(new DOMException('Proxy generation aborted', 'AbortError')));
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}
		void (async () => {
			const { resolveMediaBlob } = await import('./resolve-media-blob');
			const file = await resolveMediaBlob(media, { signal });
			// Native file reads may finish after cancellation. Never start their worker.
			signal.throwIfAborted();
			worker = new Worker(new URL('./proxy-worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = (event: MessageEvent<ProxyWorkerResponse>) => {
				const message = event.data;
				if (message.type === 'complete') {
					finish(() => {
						cache.add(media.id, {
							blob: message.blob,
							sizeBytes: message.blob.size,
							lastAccessed: Date.now()
						});
						resolve(message.blob);
					});
				} else if (message.type === 'progress') {
					onProgress(message.progress);
				} else finish(() => reject(new Error(message.message ?? 'Proxy generation failed')));
			};
			worker.onerror = (event) =>
				finish(() => reject(new Error(event.message || 'Proxy worker failed')));
			worker.onmessageerror = () =>
				finish(() => reject(new Error('Proxy worker response could not be read')));
			worker.postMessage({ file, maxHeight: PROXY_MAX_HEIGHT } satisfies ProxyRequest);
		})().catch((error) => finish(() => reject(error)));
	});
}

/** Total bytes currently held by session proxy blobs. Proxies are session memory only (never persisted), so there is no cache version to migrate. */
export function proxyCacheBytes(): number {
	return cache.sizeBytes;
}

/** Drop one session proxy and prevent an older in-flight encode from restoring it. */
export function clearProxyCache(mediaId: string): boolean {
	const existed = cachedProxy(mediaId) !== null;
	cache.delete(mediaId);
	const automatic = automaticInflight.get(mediaId);
	automaticInflight.delete(mediaId);
	automatic?.controller.abort();
	const encoding = inflight.get(mediaId);
	inflight.delete(mediaId);
	encoding?.controller.abort();
	return existed;
}
