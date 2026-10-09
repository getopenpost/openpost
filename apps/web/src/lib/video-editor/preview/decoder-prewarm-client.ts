/** Bounded main-thread cache for exact frames decoded by the preview prewarm worker. */
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { MediaMetadata } from '../media/types';
import { PreviewDecoderConnection } from './decoder-prewarm-connection';

const PREWARM_HEIGHT = 540;
const MAX_CACHE_PIXELS = 12_000_000;
const MAX_CACHE_ENTRIES = 12;

interface CachedFrame {
	key: string;
	mediaId: string;
	timestamp: number;
	bitmap: ImageBitmap;
	pixels: number;
}

const decoder = new PreviewDecoderConnection();
let session = new AbortController();
let lane = Promise.resolve();
let cachedPixels = 0;
const cache = new Map<string, CachedFrame>();
const inflight = new Map<string, { signal: AbortSignal; promise: Promise<void> }>();
const sources = new Map<string, { version: string; controller: AbortController }>();
type PreviewSource = Blob | FileSystemFileHandle;
const sourceIds = new WeakMap<PreviewSource, number>();
let sourceSequence = 0;
let resolvedSource: { key: string; signal: AbortSignal; blob: Promise<Blob> } | null = null;

function quantizedTimestamp(timestamp: number, fps: number): number {
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return Math.max(0, Math.round(timestamp * safeFps) / safeFps);
}

function frameKey(mediaId: string, timestamp: number): string {
	return `${mediaId}:${timestamp.toFixed(6)}`;
}

function sourceIdentity(source: PreviewSource | undefined): number | undefined {
	if (!source) return undefined;
	let id = sourceIds.get(source);
	if (id === undefined) {
		id = ++sourceSequence;
		sourceIds.set(source, id);
	}
	return id;
}

function sourceVersion(media: MediaMetadata, blobOverride?: Blob): string {
	return JSON.stringify([
		media.contentHash,
		media.fileLastModified,
		media.fileSize,
		media.fileName,
		media.storageType,
		media.remoteUrl,
		sourceIdentity(media.fileHandle),
		sourceIdentity(blobOverride)
	]);
}

function sourceBlob(
	key: string,
	media: MediaMetadata,
	signal: AbortSignal,
	override?: Blob
): Promise<Blob> {
	if (resolvedSource?.key === key && !resolvedSource.signal.aborted) return resolvedSource.blob;
	const entry = {
		key,
		signal,
		blob: override ? Promise.resolve(override) : resolveMediaBlob(media, { signal })
	};
	resolvedSource = entry;
	return entry.blob.catch((error) => {
		if (resolvedSource === entry) resolvedSource = null;
		throw error;
	});
}

function dropEntry(key: string): void {
	const entry = cache.get(key);
	if (!entry) return;
	cache.delete(key);
	cachedPixels -= entry.pixels;
	entry.bitmap.close();
}

function dropMediaEntries(mediaId: string): void {
	for (const [key, entry] of cache) {
		if (entry.mediaId === mediaId) dropEntry(key);
	}
}

function storeFrame(mediaId: string, timestamp: number, bitmap: ImageBitmap): void {
	const key = frameKey(mediaId, timestamp);
	dropEntry(key);
	const entry = {
		key,
		mediaId,
		timestamp,
		bitmap,
		pixels: bitmap.width * bitmap.height
	};
	cache.set(key, entry);
	cachedPixels += entry.pixels;
	while (cache.size > MAX_CACHE_ENTRIES || cachedPixels > MAX_CACHE_PIXELS) {
		const oldest = cache.keys().next();
		if (oldest.done) break;
		dropEntry(oldest.value);
	}
}

export function warmPreviewDecoder(): void {
	try {
		decoder.warm();
	} catch {
		// Prewarming is optional; the regular video element remains authoritative.
	}
}

export function prewarmPreviewFrame(
	media: MediaMetadata,
	timestampSeconds: number,
	blobOverride?: Blob
): Promise<void> {
	const timestamp = quantizedTimestamp(timestampSeconds, media.fps);
	const key = frameKey(media.id, timestamp);
	const version = sourceVersion(media, blobOverride);
	const sourceKey = JSON.stringify([media.id, version, PREWARM_HEIGHT]);
	let source = sources.get(media.id);
	if (source?.version !== version) {
		source?.controller.abort();
		dropMediaEntries(media.id);
		source = { version, controller: new AbortController() };
		sources.set(media.id, source);
	}
	if (cache.has(key)) return Promise.resolve();
	const jobKey = `${key}:${version}`;
	const pending = inflight.get(jobKey);
	if (pending && !pending.signal.aborted) return pending.promise;
	const signal = AbortSignal.any([session.signal, source.controller.signal]);
	const cancelled = Promise.withResolvers<void>();
	const onAbort = () => cancelled.resolve();
	signal.addEventListener('abort', onAbort, { once: true });
	const work = lane
		.catch(() => undefined)
		.then(async () => {
			if (signal.aborted) return;
			const blob = await sourceBlob(sourceKey, media, signal, blobOverride);
			if (signal.aborted) return;
			const entries = await decoder.decode(
				{
					sourceKey,
					blob,
					timestamps: [timestamp],
					maxHeight: PREWARM_HEIGHT
				},
				signal
			);
			if (signal.aborted) {
				for (const entry of entries) entry.bitmap.close();
				return;
			}
			for (const entry of entries) storeFrame(media.id, entry.timestamp, entry.bitmap);
		});
	const task = Promise.race([work, cancelled.promise])
		.catch(() => undefined)
		.finally(() => {
			signal.removeEventListener('abort', onAbort);
			if (inflight.get(jobKey)?.promise === task) inflight.delete(jobKey);
		});
	lane = task;
	inflight.set(jobKey, { signal, promise: task });
	return task;
}

export async function clonePrewarmedPreviewFrame(
	mediaId: string,
	timestampSeconds: number,
	maxDriftSeconds: number
): Promise<ImageBitmap | null> {
	let nearest: CachedFrame | undefined;
	let distance = Number.POSITIVE_INFINITY;
	for (const entry of cache.values()) {
		if (entry.mediaId !== mediaId) continue;
		const nextDistance = Math.abs(entry.timestamp - timestampSeconds);
		if (nextDistance < distance) {
			nearest = entry;
			distance = nextDistance;
		}
	}
	if (!nearest || distance > maxDriftSeconds) return null;
	cache.delete(nearest.key);
	cache.set(nearest.key, nearest);
	return createImageBitmap(nearest.bitmap);
}

export function clearPreviewDecoderPrewarm(): void {
	session.abort();
	session = new AbortController();
	for (const key of [...cache.keys()]) dropEntry(key);
	inflight.clear();
	sources.clear();
	resolvedSource = null;
	decoder.clear();
	lane = Promise.resolve();
}
