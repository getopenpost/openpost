/**
 * Ported from FreeCut (MIT) — timeline/workers/filmstrip-extraction-worker.ts.
 *
 * Extracts filmstrip frames at 1 source frame per second using mediabunny's
 * CanvasSink. All heavy decode and JPEG encode work happens in the worker. It
 * transfers display bitmaps before the trailing JPEG cache writes settle.
 * Trimmed versus FreeCut: Blob-based input (no blobUrl/sourceMetadata
 * indirection) and concurrency across media ids instead of range workers.
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ensureProResDecoderForCodec } from './prores-decoder';
import { FILMSTRIP_EXTRACT_HEIGHT, FILMSTRIP_FRAME_RATE } from './filmstrip-plan';

const IMAGE_FORMAT = 'image/jpeg';
const IMAGE_QUALITY = 0.7;

export interface FilmstripExtractRequest {
	type: 'extract';
	requestId: string;
	blob: Blob;
	durationSeconds: number;
	targetIndices: number[];
}

export interface FilmstripAbortRequest {
	type: 'abort';
	requestId: string;
}

export interface FilmstripWarmRequest {
	type: 'warm';
	requestId: string;
}

export interface FilmstripProgressResponse {
	type: 'progress';
	requestId: string;
	savedFrames: Array<{ index: number; blob: Blob }>;
	bitmapFrames: Array<{ index: number; bitmap: ImageBitmap }>;
	progress: number;
}

export interface FilmstripCompleteResponse {
	type: 'complete';
	requestId: string;
	frameCount: number;
	unavailableIndices: number[];
}

export interface FilmstripErrorResponse {
	type: 'error';
	requestId: string;
	error: string;
}

export interface FilmstripWarmedResponse {
	type: 'warmed';
	requestId: string;
}

export type FilmstripWorkerResponse =
	| FilmstripProgressResponse
	| FilmstripCompleteResponse
	| FilmstripErrorResponse
	| FilmstripWarmedResponse;

type WorkerRequest = FilmstripExtractRequest | FilmstripAbortRequest | FilmstripWarmRequest;

const activeRequests = new Map<string, { aborted: boolean }>();

async function extractAndSave(
	request: FilmstripExtractRequest,
	state: { aborted: boolean }
): Promise<void> {
	const { requestId, blob, durationSeconds, targetIndices } = request;

	const totalFrames = Math.max(1, Math.ceil(durationSeconds * FILMSTRIP_FRAME_RATE));
	// The client puts visible viewport frames first, so preserve request order.
	const requested = [...new Set(targetIndices)];
	const framesToExtract = requested
		.filter((index) => index >= 0 && index < totalFrames)
		.map((index) => ({ index, timestamp: index / FILMSTRIP_FRAME_RATE }));

	const completedWithoutWork =
		requested.reduce((count, index) => (index >= 0 && index < totalFrames ? count + 1 : count), 0) -
		framesToExtract.length;

	if (framesToExtract.length === 0) {
		self.postMessage({
			type: 'complete',
			requestId,
			frameCount: completedWithoutWork,
			unavailableIndices: []
		} satisfies FilmstripCompleteResponse);
		return;
	}

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	let sink: CanvasSink | null = null;

	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new Error('No video track found');
		await ensureProResDecoderForCodec(videoTrack.codec);

		const [squarePixelWidth, squarePixelHeight, rotation] = await Promise.all([
			videoTrack.getSquarePixelWidth(),
			videoTrack.getSquarePixelHeight(),
			videoTrack.getRotation()
		]);
		const quarterTurns = Math.round(rotation / 90) % 2;
		const displayWidth = quarterTurns === 0 ? squarePixelWidth : squarePixelHeight;
		const displayHeight = quarterTurns === 0 ? squarePixelHeight : squarePixelWidth;
		const scale = Math.min(1, FILMSTRIP_EXTRACT_HEIGHT / Math.max(1, displayHeight));

		sink = new CanvasSink(videoTrack, {
			width: Math.max(2, Math.round(displayWidth * scale)),
			height: Math.max(2, Math.round(displayHeight * scale)),
			fit: 'fill',
			poolSize: 4
		});

		async function* timestampGenerator(): AsyncGenerator<number> {
			for (const frame of framesToExtract) {
				if (state.aborted) return;
				yield frame.timestamp;
			}
		}

		const canvasIterable = sink.canvasesAtTimestamps(timestampGenerator());

		let savedSinceLastReport: Array<{ index: number; blob: Blob }> = [];
		let bitmapFramesSinceLastReport: Array<{ index: number; bitmap: ImageBitmap }> = [];
		let pendingEncode: Promise<{ index: number; blob: Blob }> | null = null;
		let extractedCount = completedWithoutWork;
		let frameListIndex = 0;
		const unavailableIndices: number[] = [];

		const flushPendingEncode = async (): Promise<void> => {
			if (!pendingEncode) return;
			savedSinceLastReport.push(await pendingEncode);
			pendingEncode = null;
		};

		const reportProgress = (progress: number): void => {
			const savedFrames = savedSinceLastReport;
			const bitmapFrames = bitmapFramesSinceLastReport;
			savedSinceLastReport = [];
			bitmapFramesSinceLastReport = [];
			self.postMessage(
				{
					type: 'progress',
					requestId,
					savedFrames,
					bitmapFrames,
					progress
				} satisfies FilmstripProgressResponse,
				{ transfer: bitmapFrames.map((frame) => frame.bitmap) }
			);
		};

		for await (const wrapped of canvasIterable) {
			if (state.aborted) break;

			const frame = framesToExtract[frameListIndex];
			if (!frame) break;

			if (!wrapped) {
				unavailableIndices.push(frame.index);
				frameListIndex++;
				continue;
			}

			const sourceCanvas = wrapped.canvas;
			const encodeCanvas = new OffscreenCanvas(sourceCanvas.width, sourceCanvas.height);
			const context = encodeCanvas.getContext('2d');
			if (!context) throw new Error('Filmstrip canvas context unavailable');
			context.drawImage(sourceCanvas, 0, 0);
			await flushPendingEncode();
			bitmapFramesSinceLastReport.push({
				index: frame.index,
				bitmap: await createImageBitmap(encodeCanvas)
			});
			pendingEncode = encodeCanvas
				.convertToBlob({ type: IMAGE_FORMAT, quality: IMAGE_QUALITY })
				.then((blob) => ({ index: frame.index, blob }));

			extractedCount++;
			frameListIndex++;

			const shouldReport =
				extractedCount <= 3 || extractedCount % 10 === 0 || bitmapFramesSinceLastReport.length > 0;
			if (shouldReport) {
				const progress = Math.min(99, Math.round((frameListIndex / framesToExtract.length) * 100));
				reportProgress(progress);
			}
		}

		await flushPendingEncode();
		if (
			(savedSinceLastReport.length > 0 || bitmapFramesSinceLastReport.length > 0) &&
			!state.aborted
		) {
			reportProgress(99);
		}

		if (!state.aborted) {
			self.postMessage({
				type: 'complete',
				requestId,
				frameCount: extractedCount,
				unavailableIndices
			} satisfies FilmstripCompleteResponse);
		}
	} finally {
		input.dispose();
	}
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { type } = event.data;

	try {
		switch (type) {
			case 'extract': {
				const request = event.data;
				const state = { aborted: false };
				activeRequests.set(request.requestId, state);
				try {
					await extractAndSave(request, state);
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
			case 'warm': {
				// Loading mediabunny happens via the static import above; warm exists
				// so the client can pre-boot a worker before the first extraction.
				self.postMessage({
					type: 'warmed',
					requestId: event.data.requestId
				} satisfies FilmstripWarmedResponse);
				break;
			}
		}
	} catch (error) {
		self.postMessage({
			type: 'error',
			requestId: event.data.requestId,
			error: error instanceof Error ? error.message : String(error)
		} satisfies FilmstripErrorResponse);
	}
};

export {};
