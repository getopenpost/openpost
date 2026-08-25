/**
 * Animated GIF/WebP frame extraction worker.
 *
 * Decodes every composited animation frame with the WebCodecs ImageDecoder
 * API (the same decoder path FreeCut uses for animated WebP), reporting
 * per-frame delays exactly as stored in the container. Frames stream back in
 * batches as transferred ImageBitmaps plus trailing PNG blobs for OPFS
 * persistence, so the main thread can paint progressively while encoding
 * settles. One extraction per message; abort flips a flag checked between
 * frames, mirroring filmstrip-extraction.worker.ts.
 */

export interface AnimatedImageExtractRequest {
	type: 'extract';
	requestId: string;
	blob: Blob;
	mimeType: string;
}

export interface AnimatedImageAbortRequest {
	type: 'abort';
	requestId: string;
}

export interface AnimatedImageProgressResponse {
	type: 'progress';
	requestId: string;
	frames: Array<{ index: number; bitmap: ImageBitmap }>;
	savedFrames: Array<{ index: number; blob: Blob }>;
	progress: number;
}

export interface AnimatedImageCompleteResponse {
	type: 'complete';
	requestId: string;
	durationsMs: number[];
	width: number;
	height: number;
}

export interface AnimatedImageErrorResponse {
	type: 'error';
	requestId: string;
	error: string;
}

/** Terminal response after an abort so the client promise always settles. */
export interface AnimatedImageAbortedResponse {
	type: 'aborted';
	requestId: string;
}

export type AnimatedImageWorkerResponse =
	| AnimatedImageProgressResponse
	| AnimatedImageCompleteResponse
	| AnimatedImageErrorResponse
	| AnimatedImageAbortedResponse;

type WorkerRequest = AnimatedImageExtractRequest | AnimatedImageAbortRequest;

const BATCH_FRAMES = 12;
/** Frames with a zero or missing delay display for 100ms (FreeCut parity). */
const DEFAULT_DELAY_MS = 100;
/** Upper bound on decoded frames so hostile containers cannot exhaust memory. */
const MAX_FRAMES = 2_000;

const activeRequests = new Map<string, { aborted: boolean }>();

async function extractFrames(
	request: AnimatedImageExtractRequest,
	state: { aborted: boolean }
): Promise<void> {
	const { requestId, blob, mimeType } = request;
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Optional platform API feature detection.
	if (typeof ImageDecoder === 'undefined') {
		throw new Error('This browser cannot decode animated images.');
	}

	const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: mimeType });
	const bitmapBatch: Array<{ index: number; bitmap: ImageBitmap }> = [];
	try {
		await Promise.all([decoder.tracks.ready, decoder.completed]);
		const track = decoder.tracks.selectedTrack;
		if (!track || !track.animated || track.frameCount <= 1) {
			throw new Error('This image is not animated.');
		}
		if (track.frameCount > MAX_FRAMES) {
			throw new Error(`Animation exceeds the ${MAX_FRAMES} frame limit.`);
		}
		const frameCount = track.frameCount;

		const timestampsUs: number[] = [];
		const ownDurationsMs: number[] = [];
		const savedBatch: Array<{ index: number; blob: Blob }> = [];
		let pendingEncode: Promise<{ index: number; blob: Blob }> | null = null;
		let width = 0;
		let height = 0;

		const flushPendingEncode = async (): Promise<void> => {
			if (!pendingEncode) return;
			savedBatch.push(await pendingEncode);
			pendingEncode = null;
		};
		let decodedCount = 0;
		const reportProgress = async (): Promise<void> => {
			if (bitmapBatch.length === 0 && savedBatch.length === 0) return;
			await flushPendingEncode();
			const frames = bitmapBatch.splice(0, bitmapBatch.length);
			self.postMessage(
				{
					type: 'progress',
					requestId,
					frames,
					savedFrames: savedBatch.splice(0, savedBatch.length),
					progress: Math.min(99, Math.round((decodedCount / frameCount) * 100))
				} satisfies AnimatedImageProgressResponse,
				{ transfer: frames.map((frame) => frame.bitmap) }
			);
		};

		for (let index = 0; index < frameCount; index++) {
			if (state.aborted) throw new DOMException('Animated image extraction aborted', 'AbortError');
			const result = await decoder.decode({ frameIndex: index });
			const videoFrame = result.image;
			let bitmap: ImageBitmap;
			try {
				timestampsUs.push(videoFrame.timestamp ?? -1);
				ownDurationsMs.push((videoFrame.duration ?? 0) / 1000);
				bitmap = await createImageBitmap(videoFrame);
				decodedCount += 1;
				width = width || videoFrame.displayWidth;
				height = height || videoFrame.displayHeight;
			} finally {
				videoFrame.close();
			}

			bitmapBatch.push({ index, bitmap });
			// Settle the previous frame's PNG encode before queueing this one so no
			// encode result is dropped when batches report.
			await flushPendingEncode();
			const encodeCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			encodeCanvas.getContext('2d')?.drawImage(bitmap, 0, 0);
			pendingEncode = encodeCanvas.convertToBlob({ type: 'image/png' }).then((encoded) => ({
				index,
				blob: encoded
			}));

			if (bitmapBatch.length >= BATCH_FRAMES || index === frameCount - 1) {
				await reportProgress();
			}
		}
		await flushPendingEncode();

		// Exact per-frame delays: each frame's stored duration wins, then the gap
		// to the next frame's timestamp, then the display default.
		const durationsMs = ownDurationsMs.map((own, index) => {
			if (own > 0) return own;
			const current = timestampsUs[index];
			const next = timestampsUs[index + 1];
			if (current >= 0 && next !== undefined && current >= 0 && next > current) {
				return (next - current) / 1000;
			}
			return DEFAULT_DELAY_MS;
		});

		self.postMessage({
			type: 'complete',
			requestId,
			durationsMs,
			width,
			height
		} satisfies AnimatedImageCompleteResponse);
	} catch (error) {
		for (const entry of bitmapBatch) entry.bitmap.close();
		bitmapBatch.length = 0;
		throw error;
	} finally {
		decoder.close();
	}
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { type } = event.data;
	switch (type) {
		case 'extract': {
			const request = event.data;
			const state = { aborted: false };
			activeRequests.set(request.requestId, state);
			try {
				await extractFrames(request, state);
			} catch (error) {
				const aborted =
					state.aborted ||
					(error instanceof DOMException
						? error.name === 'AbortError'
						: error instanceof Error && error.name === 'AbortError');
				if (aborted) {
					// Deterministic terminal response: the client promise must settle
					// on cancel so media tasks finish and retries can start.
					self.postMessage({
						type: 'aborted',
						requestId: request.requestId
					} satisfies AnimatedImageAbortedResponse);
				} else {
					self.postMessage({
						type: 'error',
						requestId: request.requestId,
						error: error instanceof Error ? error.message : String(error)
					} satisfies AnimatedImageErrorResponse);
				}
			} finally {
				activeRequests.delete(request.requestId);
			}
			break;
		}
		case 'abort': {
			const state = activeRequests.get(event.data.requestId);
			if (state) state.aborted = true;
			break;
		}
	}
};

export {};
