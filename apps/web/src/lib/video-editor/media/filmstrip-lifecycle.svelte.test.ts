import { afterEach, expect, it, vi } from 'vitest';
import { filmstripCache } from './filmstrip-client';
import { saveFilmstripFrame, saveFilmstripIndex } from './filmstrip-persistence';
import type { MediaMetadata } from '@openpost/editor-shared/media';
import { mediaTasks } from './media-tasks.svelte';
import type {
	FilmstripAbortRequest,
	FilmstripExtractRequest,
	FilmstripWarmRequest,
	FilmstripWorkerResponse
} from './filmstrip-extraction.worker';

const mediaIds: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const id of mediaIds.splice(0)) await filmstripCache.clearMedia(id);
	filmstripCache.clearAll();
	vi.useRealTimers();
});

function holdExtractions() {
	const requests: Array<{ worker: Worker; request: FilmstripExtractRequest }> = [];
	const postMessage = Worker.prototype.postMessage;
	// Control the decoder boundary while keeping real workers, cache state and ImageBitmaps.
	vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (
		this: Worker,
		message: FilmstripExtractRequest | FilmstripWarmRequest | FilmstripAbortRequest
	) {
		if (message.type === 'extract') requests.push({ worker: this, request: message });
		else postMessage.call(this, message);
	});
	return requests;
}

function workerResponse(worker: Worker, response: FilmstripWorkerResponse): void {
	worker.dispatchEvent(new MessageEvent('message', { data: response }));
}

function cloudSource(media: MediaMetadata): void {
	media.storageType = 'cloud';
	media.remoteUrl = `/filmstrip-source-${media.id}`;
	const originalFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, options) =>
		input === media.remoteUrl
			? Promise.resolve(new Response(new Blob(['source'])))
			: originalFetch(input, options)
	);
}

async function persistedSource(frameCount = 1): Promise<MediaMetadata> {
	const id = crypto.randomUUID();
	mediaIds.push(id);
	const canvas = new OffscreenCanvas(8, 8);
	const context = canvas.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 8, 8);
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	const indices = Array.from({ length: frameCount }, (_, index) => index);
	for (let index = 0; index < indices.length; index += 32) {
		await Promise.all(
			indices.slice(index, index + 32).map((frame) => saveFilmstripFrame(id, frame, blob))
		);
	}
	await saveFilmstripIndex(id, indices);
	return {
		id,
		storageType: 'workspace',
		fileName: 'source.mp4',
		fileSize: 100,
		mimeType: 'video/mp4',
		duration: frameCount,
		width: 8,
		height: 8,
		fps: 30,
		codec: 'h264',
		bitrate: 100,
		tags: ['video']
	};
}

it('keeps subscribed filmstrips and releases unobserved decoded frames under cache pressure', async () => {
	// The production cache accounts 1300 thumbnails at about 88MiB per source.
	// Small real PNGs exercise its eviction boundary without decoding 256MiB in a test.
	const firstMedia = await persistedSource(1300);
	const secondMedia = await persistedSource(1300);
	const thirdMedia = await persistedSource(1300);
	const unsubscribe = filmstripCache.subscribe(firstMedia.id, () => undefined);
	try {
		const first = await filmstripCache.getFilmstrip(firstMedia, { allowExtraction: false });
		const second = await filmstripCache.getFilmstrip(secondMedia, { allowExtraction: false });
		const third = await filmstripCache.getFilmstrip(thirdMedia, { allowExtraction: false });
		expect(filmstripCache.cachedFilmstrip(firstMedia.id)).toBe(first);
		expect(filmstripCache.cachedFilmstrip(secondMedia.id)).toBeNull();
		expect(filmstripCache.cachedFilmstrip(thirdMedia.id)).toBe(third);
		expect(first.frames[0].bitmap?.width).toBe(8);
		expect(second.frames.every((frame) => frame.bitmap?.width === 0)).toBe(true);
		await expect(fetch(second.frames[0].url!)).rejects.toThrow();
	} finally {
		unsubscribe();
	}
}, 60_000);

it('restores persisted filmstrips and releases decoded frames when their media cache is cleared', async () => {
	const media = await persistedSource();
	const filmstrip = await filmstripCache.getFilmstrip(media, { allowExtraction: false });
	expect(filmstrip.frames).toHaveLength(1);
	const frame = filmstrip.frames[0];
	expect(frame.bitmap?.width).toBe(8);
	expect((await fetch(frame.url!)).ok).toBe(true);
	await filmstripCache.clearMedia(media.id);
	expect(filmstripCache.cachedFilmstrip(media.id)).toBeNull();
	expect(frame.bitmap?.width).toBe(0);
	await expect(fetch(frame.url!)).rejects.toThrow();
});

for (const scope of ['media', 'all'] as const) {
	it(`releases a persisted frame that finishes decoding after clearing ${scope} filmstrips`, async () => {
		const media = await persistedSource();
		const canvas = new OffscreenCanvas(8, 8);
		canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
		const bitmap = await createImageBitmap(canvas);
		const decoded = Promise.withResolvers<ImageBitmap>();
		const decode = vi.spyOn(globalThis, 'createImageBitmap').mockReturnValueOnce(decoded.promise);
		const createUrl = vi.spyOn(URL, 'createObjectURL');
		try {
			const pending = filmstripCache.getFilmstrip(media, { allowExtraction: false });
			await expect.poll(() => decode.mock.calls.length).toBe(1);
			if (scope === 'media') await filmstripCache.clearMedia(media.id);
			else filmstripCache.clearAll();
			decoded.resolve(bitmap);
			const restored = await pending;
			expect(restored.frames).toEqual([]);
			expect(filmstripCache.cachedFilmstrip(media.id)).toBeNull();
			expect(bitmap.width).toBe(0);
			for (const result of createUrl.mock.results) {
				if (result.type === 'return') await expect(fetch(result.value)).rejects.toThrow();
			}
		} finally {
			decoded.resolve(bitmap);
			bitmap.close();
			for (const result of createUrl.mock.results) {
				if (result.type === 'return') URL.revokeObjectURL(result.value);
			}
		}
	});

	it(`does not restart joined filmstrip requests after clearing ${scope} filmstrips`, async () => {
		const media = await persistedSource();
		const canvas = new OffscreenCanvas(8, 8);
		canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
		const bitmap = await createImageBitmap(canvas);
		const decoded = Promise.withResolvers<ImageBitmap>();
		const decode = vi.spyOn(globalThis, 'createImageBitmap').mockReturnValueOnce(decoded.promise);
		const first = filmstripCache.getFilmstrip(media);
		const joined = filmstripCache.getFilmstrip(media).then(
			(result) => result,
			(error: Error) => error
		);
		await expect.poll(() => decode.mock.calls.length).toBe(1);
		if (scope === 'media') await filmstripCache.clearMedia(media.id);
		else filmstripCache.clearAll();
		decoded.resolve(bitmap);
		expect((await first).frames).toEqual([]);
		expect(await joined).toMatchObject({ frames: [] });
		expect(filmstripCache.cachedFilmstrip(media.id)).toBeNull();
		expect(mediaTasks.list.filter((task) => task.mediaId === media.id)).toEqual([]);
	});
}

it('does not restart extraction when a pending source read finishes after clearing the cache', async () => {
	const media = await persistedSource();
	await filmstripCache.clearMedia(media.id);
	media.storageType = 'cloud';
	media.remoteUrl = `/filmstrip-source-${media.id}`;
	const response = Promise.withResolvers<Response>();
	const originalFetch = globalThis.fetch;
	const fetchSource = vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation((input, options) =>
			input === media.remoteUrl ? response.promise : originalFetch(input, options)
		);
	const pending = filmstripCache.getFilmstrip(media).then(
		() => null,
		(error: Error) => error
	);
	await expect
		.poll(() => fetchSource.mock.calls.some(([input]) => input === media.remoteUrl))
		.toBe(true);
	filmstripCache.clearAll();
	response.resolve(new Response(new Blob(['source'])));
	expect(await pending).toMatchObject({ name: 'AbortError' });
	expect(filmstripCache.cachedFilmstrip(media.id)).toBeNull();
	expect(mediaTasks.list.filter((task) => task.mediaId === media.id)).toEqual([]);
});

it('allows a fresh extraction after clearing a pending source read for one media item', async () => {
	const media = await persistedSource();
	await filmstripCache.clearMedia(media.id);
	media.storageType = 'cloud';
	media.remoteUrl = `/filmstrip-source-${media.id}`;
	const response = Promise.withResolvers<Response>();
	let sourceRequested = false;
	let holdSource = true;
	const originalFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, options) => {
		if (input !== media.remoteUrl) return originalFetch(input, options);
		sourceRequested = true;
		return holdSource ? response.promise : Promise.resolve(new Response(new Blob(['source'])));
	});
	const requests = holdExtractions();
	const old = filmstripCache.getFilmstrip(media).catch((error: Error) => error);
	await expect.poll(() => sourceRequested).toBe(true);
	await filmstripCache.clearMedia(media.id);
	response.resolve(new Response(new Blob(['source'])));
	expect(await old).toMatchObject({ name: 'AbortError' });
	holdSource = false;
	const fresh = filmstripCache.getFilmstrip(media).catch((error: Error) => error);
	await expect.poll(() => requests.length).toBe(1);
	const { worker, request } = requests[0];
	workerResponse(worker, {
		type: 'complete',
		requestId: request.requestId,
		frameCount: 0,
		unavailableIndices: [0]
	});
	expect(await fresh).toMatchObject({ isComplete: true });
});

it('retains existing frames while refinement is waiting for source bytes under cache pressure', async () => {
	const firstMedia = await persistedSource(1300);
	const secondMedia = await persistedSource(1300);
	const thirdMedia = await persistedSource(1300);
	const first = await filmstripCache.getFilmstrip(firstMedia, { allowExtraction: false });
	firstMedia.duration++;
	firstMedia.storageType = 'cloud';
	firstMedia.remoteUrl = `/filmstrip-source-${firstMedia.id}`;
	const response = Promise.withResolvers<Response>();
	let sourceRequested = false;
	const originalFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, options) => {
		if (input !== firstMedia.remoteUrl) return originalFetch(input, options);
		sourceRequested = true;
		return response.promise;
	});
	const requests = holdExtractions();
	const pending = filmstripCache.getFilmstrip(firstMedia);
	// Refinement restores 1,300 real persisted bitmaps before requesting the source.
	// Wait for that boundary without imposing the default one-second decode budget.
	await expect.poll(() => sourceRequested, { timeout: 10_000 }).toBe(true);
	await filmstripCache.getFilmstrip(secondMedia, { allowExtraction: false });
	await filmstripCache.getFilmstrip(thirdMedia, { allowExtraction: false });
	const retainedDuringRead = filmstripCache.cachedFilmstrip(firstMedia.id) !== null;
	response.resolve(new Response(new Blob(['source'])));
	await expect.poll(() => requests.length).toBe(1);
	const { worker, request } = requests[0];
	workerResponse(worker, {
		type: 'complete',
		requestId: request.requestId,
		frameCount: 0,
		unavailableIndices: [1300]
	});
	const refined = await pending;
	expect(retainedDuringRead).toBe(true);
	expect(first.frames[0].bitmap?.width).toBe(0);
	// Loading the persisted refinement replaces the earlier cache's bitmap instances.
	expect(refined.frames.every((frame) => frame.bitmap?.width === 8)).toBe(true);
}, 60_000);

it('keeps an unsubscribed refinement alive until it settles, then releases it after the idle timeout', async () => {
	const media = await persistedSource();
	media.duration = 2;
	media.storageType = 'cloud';
	media.remoteUrl = `/filmstrip-source-${media.id}`;
	const response = Promise.withResolvers<Response>();
	let sourceRequested = false;
	const originalFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation((input, options) => {
		if (input !== media.remoteUrl) return originalFetch(input, options);
		sourceRequested = true;
		return response.promise;
	});
	const requests = holdExtractions();
	const unsubscribe = filmstripCache.subscribe(media.id, () => undefined);
	const pending = filmstripCache.getFilmstrip(media);
	await expect.poll(() => sourceRequested).toBe(true);
	const bitmap = filmstripCache.cachedFilmstrip(media.id)!.frames[0].bitmap!;
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	unsubscribe();
	await vi.advanceTimersByTimeAsync(16_000);
	const widthWhileLoading = bitmap.width;
	response.resolve(new Response(new Blob(['source'])));
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	const { worker, request } = requests[0];
	workerResponse(worker, {
		type: 'complete',
		requestId: request.requestId,
		frameCount: 0,
		unavailableIndices: [1]
	});
	await pending;
	expect(widthWhileLoading).toBe(8);
	await vi.advanceTimersByTimeAsync(14_999);
	expect(bitmap.width).toBe(8);
	await vi.advanceTimersByTimeAsync(1);
	expect(bitmap.width).toBe(0);
	expect(filmstripCache.cachedFilmstrip(media.id)).toBeNull();
});

for (const outcome of ['cancel', 'encoded'] as const) {
	it(`owns transferred filmstrip bitmaps before their JPEG finishes: ${outcome}`, async () => {
		const media = await persistedSource();
		await filmstripCache.clearMedia(media.id);
		cloudSource(media);
		const requests = holdExtractions();
		const pending = filmstripCache.getFilmstrip(media).catch((error: Error) => error);
		await expect.poll(() => requests.length).toBe(1);
		const { worker, request } = requests[0];
		const canvas = new OffscreenCanvas(8, 8);
		canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
		const bitmap = await createImageBitmap(canvas);
		workerResponse(worker, {
			type: 'progress',
			requestId: request.requestId,
			bitmapFrames: [{ index: 0, bitmap }],
			savedFrames: [],
			progress: 50
		});
		if (outcome === 'cancel') {
			await filmstripCache.clearMedia(media.id);
			expect(await pending).toMatchObject({ name: 'AbortError' });
			expect(bitmap.width).toBe(0);
		} else {
			expect(filmstripCache.cachedFilmstrip(media.id)?.frames[0]).toMatchObject({
				bitmap,
				url: null
			});
			workerResponse(worker, {
				type: 'progress',
				requestId: request.requestId,
				bitmapFrames: [],
				savedFrames: [{ index: 0, blob: await canvas.convertToBlob() }],
				progress: 100
			});
			workerResponse(worker, {
				type: 'complete',
				requestId: request.requestId,
				frameCount: 1,
				unavailableIndices: []
			});
			expect(await pending).toMatchObject({ isComplete: true });
			expect(bitmap.width).toBe(8);
			await filmstripCache.clearMedia(media.id);
			expect(bitmap.width).toBe(0);
		}
	});
}
