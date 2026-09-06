/** Bounded main-thread cache for exact frames decoded by the preview prewarm worker. */
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { MediaMetadata } from '../media/types';
import type {
	DecoderPrewarmWorkerRequest,
	DecoderPrewarmWorkerResponse
} from './decoder-prewarm.worker';

const PREWARM_HEIGHT = 540;
const MAX_CACHE_PIXELS = 12_000_000;
const MAX_CACHE_ENTRIES = 12;
const DECODE_TIMEOUT_MS = 8_000;

interface CachedFrame {
	key: string;
	mediaId: string;
	timestamp: number;
	bitmap: ImageBitmap;
	pixels: number;
}

let worker: Worker | null = null;
let requestSequence = 0;
let lane = Promise.resolve();
let cachedPixels = 0;
const cache = new Map<string, CachedFrame>();
const inflight = new Map<string, Promise<void>>();
const sourceVersionByMedia = new Map<string, string>();
const blobVersionIds = new WeakMap<Blob, number>();
let blobVersionSequence = 0;

function quantizedTimestamp(timestamp: number, fps: number): number {
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return Math.max(0, Math.round(timestamp * safeFps) / safeFps);
}

function frameKey(mediaId: string, timestamp: number): string {
	return `${mediaId}:${timestamp.toFixed(6)}`;
}

function sourceKey(media: MediaMetadata, blob: Blob): string {
	return [
		media.id,
		media.contentHash ?? '',
		media.fileLastModified ?? '',
		blob.size,
		blob.type,
		PREWARM_HEIGHT
	].join(':');
}

function sourceVersion(media: MediaMetadata, blobOverride?: Blob): string {
	let overrideId = '';
	if (blobOverride) {
		let id = blobVersionIds.get(blobOverride);
		if (id === undefined) {
			id = ++blobVersionSequence;
			blobVersionIds.set(blobOverride, id);
		}
		overrideId = String(id);
	}
	return [
		media.contentHash ?? '',
		media.fileLastModified ?? '',
		media.fileSize,
		media.fileName,
		blobOverride?.size ?? '',
		blobOverride?.type ?? '',
		overrideId
	].join(':');
}

function getWorker(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL('./decoder-prewarm.worker.ts', import.meta.url), { type: 'module' });
	return worker;
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

function decode(
	media: MediaMetadata,
	blob: Blob,
	timestamps: number[]
): Promise<Array<{ timestamp: number; bitmap: ImageBitmap }>> {
	const requestId = `preview-prewarm-${++requestSequence}`;
	const decoder = getWorker();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Preview decoder prewarm timed out.'));
		}, DECODE_TIMEOUT_MS);
		const cleanup = () => {
			clearTimeout(timeout);
			decoder.removeEventListener('message', onMessage);
			decoder.removeEventListener('error', onError);
		};
		const onMessage = (event: MessageEvent<DecoderPrewarmWorkerResponse>) => {
			if (event.data.requestId !== requestId) return;
			cleanup();
			if (event.data.type === 'decoded') resolve(event.data.entries);
			else if (event.data.type === 'error') reject(new Error(event.data.error));
			else resolve([]);
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			reject(event.error instanceof Error ? event.error : new Error(event.message));
		};
		decoder.addEventListener('message', onMessage);
		decoder.addEventListener('error', onError);
		decoder.postMessage({
			type: 'decode',
			requestId,
			sourceKey: sourceKey(media, blob),
			blob,
			timestamps,
			maxHeight: PREWARM_HEIGHT
		} satisfies DecoderPrewarmWorkerRequest);
	});
}

export function warmPreviewDecoder(): void {
	try {
		const decoder = getWorker();
		decoder.postMessage({
			type: 'warm',
			requestId: `preview-warm-${++requestSequence}`
		} satisfies DecoderPrewarmWorkerRequest);
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
	const previousVersion = sourceVersionByMedia.get(media.id);
	if (previousVersion !== version) {
		dropMediaEntries(media.id);
		sourceVersionByMedia.set(media.id, version);
	}
	if (cache.has(key)) return Promise.resolve();
	const jobKey = `${key}:${version}`;
	const pending = inflight.get(jobKey);
	if (pending) return pending;
	const task = lane
		.catch(() => undefined)
		.then(async () => {
			const blob = blobOverride ?? (await resolveMediaBlob(media));
			const entries = await decode(media, blob, [timestamp]);
			if (sourceVersionByMedia.get(media.id) !== version) {
				for (const entry of entries) entry.bitmap.close();
				return;
			}
			for (const entry of entries) storeFrame(media.id, entry.timestamp, entry.bitmap);
		})
		.catch(() => undefined)
		.finally(() => inflight.delete(jobKey));
	lane = task;
	inflight.set(jobKey, task);
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
	for (const key of [...cache.keys()]) dropEntry(key);
	inflight.clear();
	sourceVersionByMedia.clear();
	worker?.terminate();
	worker = null;
	lane = Promise.resolve();
}
