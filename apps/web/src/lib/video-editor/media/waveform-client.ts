/**
 * Ported from FreeCut (MIT) — waveform service client. Caches peak arrays
 * per mediaId so timeline rerenders reuse decoded audio.
 *
 * Memory tier ported from FreeCut's waveform-cache.ts: a size-bounded
 * least-recently-accessed cache replaces the unbounded Map, so long sessions
 * evict stale peaks instead of growing without limit.
 */

import type { MediaMetadata } from './types';
import type { WaveformWorkerResponse } from './waveform-worker';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';
import { loadWaveform, saveWaveform } from './waveform-persistence';
import { removeOpfsEntry } from './opfs-cache';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';

export interface WaveformData {
	peaks: Float32Array;
	durationSeconds: number;
	samplesPerSecond: number;
	loadedSamples: number;
	isComplete: boolean;
}

interface WaveformMetadata {
	data: WaveformData | null;
	error?: string;
	sizeBytes: number;
	lastAccessed: number;
}

const cache = new SizedAccessedMemoryCache<WaveformMetadata>(128 * 1024 * 1024);
const inflight = new Map<string, Promise<WaveformData>>();
const cacheVersions = new Map<string, number>();
const pendingPersistence = new Map<string, Promise<void>>();
const subscribers = new Map<string, Set<(data: WaveformData) => void>>();

const SAMPLES_PER_SECOND = 500;

function publish(mediaId: string, data: WaveformData): void {
	cache.add(mediaId, {
		data,
		sizeBytes: data.peaks.byteLength,
		lastAccessed: Date.now()
	});
	for (const subscriber of subscribers.get(mediaId) ?? []) subscriber(data);
}

export function subscribeWaveform(
	mediaId: string,
	subscriber: (data: WaveformData) => void
): () => void {
	const callbacks = subscribers.get(mediaId) ?? new Set<(data: WaveformData) => void>();
	callbacks.add(subscriber);
	subscribers.set(mediaId, callbacks);
	const existing = cachedWaveform(mediaId);
	if (existing) subscriber(existing);
	return () => {
		callbacks.delete(subscriber);
		if (callbacks.size === 0) subscribers.delete(mediaId);
	};
}

export function cachedWaveform(mediaId: string): WaveformData | null {
	return cache.get(mediaId)?.data ?? null;
}

export async function getWaveform(media: MediaMetadata): Promise<WaveformData> {
	const existing = cache.get(media.id);
	if (existing?.data?.isComplete) return existing.data;
	const pending = inflight.get(media.id);
	if (pending) return pending;
	if (existing && !existing.data) {
		throw new Error(existing.error ?? 'Waveform unavailable');
	}
	const version = cacheVersions.get(media.id) ?? 0;
	const promise = loadOrDecode(media, version);
	inflight.set(media.id, promise);
	const clearInflight = () => {
		if (inflight.get(media.id) === promise) inflight.delete(media.id);
	};
	void promise.then(clearInflight, clearInflight);
	return promise;
}

function cacheIsCurrent(mediaId: string, version: number): boolean {
	return (cacheVersions.get(mediaId) ?? 0) === version;
}

async function loadOrDecode(media: MediaMetadata, version: number): Promise<WaveformData> {
	const persisted = await loadWaveform(media.id);
	if (persisted) {
		if (cacheIsCurrent(media.id, version)) {
			publish(media.id, persisted);
		}
		return persisted;
	}
	const decoded = await decode(media, version);
	if (cacheIsCurrent(media.id, version)) {
		void queueWaveformPersistence(media.id, version, decoded);
	}
	return decoded;
}

function queueWaveformPersistence(
	mediaId: string,
	version: number,
	data: WaveformData
): Promise<void> {
	const pending = pendingPersistence.get(mediaId) ?? Promise.resolve();
	const next = pending
		.catch(() => undefined)
		.then(async () => {
			if (!cacheIsCurrent(mediaId, version)) return;
			await saveWaveform(mediaId, data);
		})
		.catch(() => undefined);
	pendingPersistence.set(mediaId, next);
	void next.then(() => {
		if (pendingPersistence.get(mediaId) === next) pendingPersistence.delete(mediaId);
	});
	return next;
}

async function decode(media: MediaMetadata, version: number): Promise<WaveformData> {
	const taskId = mediaTaskId('waveform', media.id);
	const worker = new Worker(new URL('./waveform-worker.ts', import.meta.url), {
		type: 'module'
	});
	const requestId = `waveform-${media.id}-${crypto.randomUUID()}`;
	let cancelled = false;
	let rejectDecode: ((error: DOMException) => void) | null = null;
	const cancel = () => {
		cancelled = true;
		worker.postMessage({ type: 'abort', requestId });
		worker.terminate();
		rejectDecode?.(new DOMException('Waveform decoding cancelled', 'AbortError'));
	};
	const taskRevision = mediaTasks.start({
		id: taskId,
		kind: 'waveform',
		mediaId: media.id,
		label: media.fileName,
		stage: 'decoding',
		progress: 0,
		onCancel: cancel
	});
	try {
		const { resolveMediaBlob } = await import('./import.svelte');
		const file = await resolveMediaBlob(media);
		if (cancelled) throw new DOMException('Waveform decoding cancelled', 'AbortError');
		return await new Promise<WaveformData>((resolve, reject) => {
			rejectDecode = reject;
			let data: WaveformData | null = null;
			if (cancelled) {
				reject(new DOMException('Waveform decoding cancelled', 'AbortError'));
				return;
			}
			worker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
				const message = event.data;
				if (message.requestId !== requestId) return;
				if (message.type === 'progress') {
					mediaTasks.update(taskId, { progress: message.progress }, taskRevision);
					return;
				}
				if (message.type === 'init') {
					data = {
						peaks: new Float32Array(message.totalSamples),
						durationSeconds: message.durationSeconds,
						samplesPerSecond: SAMPLES_PER_SECOND,
						loadedSamples: 0,
						isComplete: false
					};
					if (cacheIsCurrent(media.id, version)) publish(media.id, data);
					return;
				}
				if (message.type === 'chunk') {
					if (!data) return;
					data.peaks.set(message.peaks, message.startIndex);
					data = {
						...data,
						loadedSamples: Math.max(data.loadedSamples, message.startIndex + message.peaks.length)
					};
					if (cacheIsCurrent(media.id, version)) publish(media.id, data);
					return;
				}
				if (message.type === 'complete') {
					if (!data) {
						reject(new Error('Waveform worker completed before initialization'));
						return;
					}
					data = {
						...data,
						loadedSamples: data.peaks.length,
						isComplete: true
					};
					if (cacheIsCurrent(media.id, version)) {
						publish(media.id, data);
					}
					resolve(data);
					return;
				}
				if (cacheIsCurrent(media.id, version)) {
					cache.add(media.id, {
						data: null,
						error: message.message || 'decode failed',
						sizeBytes: 0,
						lastAccessed: Date.now()
					});
				}
				reject(new Error(message.message || 'Waveform decoding failed'));
			};
			worker.onerror = (event) => reject(new Error(event.message));
			worker.postMessage({
				type: 'generate',
				requestId,
				file,
				samplesPerSecond: SAMPLES_PER_SECOND
			});
		});
	} catch (error) {
		const wasCancelled = error instanceof Error && error.name === 'AbortError';
		if (!wasCancelled && cacheIsCurrent(media.id, version)) {
			cache.add(media.id, {
				data: null,
				error: error instanceof Error ? error.message : String(error),
				sizeBytes: 0,
				lastAccessed: Date.now()
			});
		}
		throw error;
	} finally {
		rejectDecode = null;
		mediaTasks.finish(taskId, taskRevision);
		worker.terminate();
	}
}

/** Clear one media item's derived waveform without touching source bytes. */
export async function clearWaveformCache(mediaId: string): Promise<void> {
	const taskId = mediaTaskId('waveform', mediaId);
	mediaTasks.cancel(taskId);
	mediaTasks.finish(taskId);
	cacheVersions.set(mediaId, (cacheVersions.get(mediaId) ?? 0) + 1);
	cache.delete(mediaId);
	inflight.delete(mediaId);
	await pendingPersistence.get(mediaId)?.catch(() => undefined);
	await removeOpfsEntry('waveforms', mediaId);
}
