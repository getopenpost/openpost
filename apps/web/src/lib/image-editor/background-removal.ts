export interface BackgroundRemovalProgress {
	stage: string;
	progress: number;
}

export const BACKGROUND_REMOVAL_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const BACKGROUND_REMOVAL_MAX_OUTPUT_PIXELS = 40_000_000;
export const BACKGROUND_REMOVAL_MAX_OUTPUT_DIMENSION = 8192;
const BACKGROUND_REMOVAL_PROCESSING_MAX_DIMENSION = 4096;

type BackgroundRemovalWorkerResponse =
	| { type: 'progress'; key: string; progress: number }
	| { type: 'complete'; result: Blob }
	| { type: 'error'; message: string };

export function resolveBackgroundRemovalPublicPath(
	publicPath: string,
	currentLocation: string
): string {
	return new URL(publicPath.endsWith('/') ? publicPath : `${publicPath}/`, currentLocation).href;
}

export class ImageEditorBackgroundRemoval {
	private worker: Worker | null = null;
	private pendingReject: ((reason?: Error | DOMException) => void) | null = null;
	private pending = false;
	private abortController: AbortController | null = null;

	async remove(
		image: Blob,
		publicPath = '/image-editor-models/',
		onProgress?: (progress: BackgroundRemovalProgress) => void
	): Promise<Blob> {
		if (this.pending) {
			throw new Error('Background removal is already running.');
		}
		this.pending = true;
		const abortController = new AbortController();
		this.abortController = abortController;
		try {
			const prepared = await prepareBackgroundRemovalInput(
				image,
				onProgress,
				abortController.signal
			);
			const processed = await this.runWorker(
				prepared.processingImage,
				publicPath,
				onProgress,
				abortController.signal
			);
			abortController.signal.throwIfAborted();
			if (!prepared.wasResized) return processed;
			onProgress?.({ stage: 'Restoring original resolution', progress: 0 });
			const result = await restoreOriginalResolution(image, processed, abortController.signal);
			onProgress?.({ stage: 'Restoring original resolution', progress: 1 });
			return result;
		} finally {
			if (this.abortController === abortController) this.abortController = null;
			this.pending = false;
			this.pendingReject = null;
		}
	}

	private async runWorker(
		image: Blob,
		publicPath: string,
		onProgress: ((progress: BackgroundRemovalProgress) => void) | undefined,
		signal: AbortSignal
	): Promise<Blob> {
		const worker = this.ensureWorker();
		const resolvedPublicPath = resolveBackgroundRemovalPublicPath(publicPath, window.location.href);
		return await new Promise<Blob>((resolve, reject) => {
			this.pendingReject = reject;
			worker.onmessage = (event: MessageEvent<BackgroundRemovalWorkerResponse>) => {
				const message = event.data;
				if (message.type === 'progress') {
					onProgress?.({ stage: message.key, progress: message.progress });
				}
				if (message.type === 'complete') {
					resolve(message.result);
				}
				if (message.type === 'error') {
					reject(new Error(message.message));
				}
			};
			worker.onerror = (event) => {
				this.worker = null;
				worker.terminate();
				reject(new Error(event.message || 'Background removal worker failed.'));
			};
			signal.addEventListener(
				'abort',
				() => reject(new DOMException('Background removal was canceled.', 'AbortError')),
				{ once: true }
			);
			worker.postMessage({
				type: 'remove',
				image,
				publicPath: resolvedPublicPath,
				preferGPU: 'gpu' in navigator
			});
		});
	}

	private ensureWorker(): Worker {
		if (!this.worker) {
			this.worker = new Worker(new URL('./background-removal.worker.ts', import.meta.url), {
				type: 'module'
			});
		}
		return this.worker;
	}

	cancel(): void {
		this.abortController?.abort();
		this.pendingReject?.(new DOMException('Background removal was canceled.', 'AbortError'));
		this.worker?.terminate();
		this.worker = null;
		this.pendingReject = null;
	}

	dispose(): void {
		this.cancel();
	}
}

interface PreparedBackgroundRemovalInput {
	processingImage: Blob;
	wasResized: boolean;
}

export async function prepareBackgroundRemovalInput(
	image: Blob,
	onProgress?: (progress: BackgroundRemovalProgress) => void,
	signal?: AbortSignal
): Promise<PreparedBackgroundRemovalInput> {
	if (image.size > BACKGROUND_REMOVAL_MAX_INPUT_BYTES) {
		throw new Error('Choose an image smaller than 25 MB.');
	}
	signal?.throwIfAborted();
	const bitmap = await createImageBitmap(image);
	if (signal?.aborted) {
		bitmap.close();
		signal.throwIfAborted();
	}
	const pixels = bitmap.width * bitmap.height;
	if (
		pixels > BACKGROUND_REMOVAL_MAX_OUTPUT_PIXELS ||
		bitmap.width > BACKGROUND_REMOVAL_MAX_OUTPUT_DIMENSION ||
		bitmap.height > BACKGROUND_REMOVAL_MAX_OUTPUT_DIMENSION
	) {
		bitmap.close();
		throw new Error('Choose an image no larger than 40 megapixels or 8192 pixels on one side.');
	}
	if (
		bitmap.width <= BACKGROUND_REMOVAL_PROCESSING_MAX_DIMENSION &&
		bitmap.height <= BACKGROUND_REMOVAL_PROCESSING_MAX_DIMENSION
	) {
		bitmap.close();
		return { processingImage: image, wasResized: false };
	}
	onProgress?.({ stage: 'Preparing an optimized processing copy', progress: 0 });
	const scale = Math.min(
		BACKGROUND_REMOVAL_PROCESSING_MAX_DIMENSION / bitmap.width,
		BACKGROUND_REMOVAL_PROCESSING_MAX_DIMENSION / bitmap.height
	);
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.round(bitmap.width * scale)),
		Math.max(1, Math.round(bitmap.height * scale))
	);
	const context = canvas.getContext('2d');
	if (!context) {
		bitmap.close();
		throw new Error('This browser cannot prepare the image for background removal.');
	}
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	signal?.throwIfAborted();
	onProgress?.({ stage: 'Preparing an optimized processing copy', progress: 1 });
	const processingImage = await canvas.convertToBlob({ type: 'image/png' });
	signal?.throwIfAborted();
	return {
		processingImage,
		wasResized: true
	};
}

export async function restoreOriginalResolution(
	original: Blob,
	processed: Blob,
	signal?: AbortSignal
): Promise<Blob> {
	signal?.throwIfAborted();
	const [originalResult, processedResult] = await Promise.allSettled([
		createImageBitmap(original),
		createImageBitmap(processed)
	]);
	if (originalResult.status === 'rejected') {
		if (processedResult.status === 'fulfilled') processedResult.value.close();
		throw originalResult.reason;
	}
	if (processedResult.status === 'rejected') {
		originalResult.value.close();
		throw processedResult.reason;
	}
	const originalBitmap = originalResult.value;
	const processedBitmap = processedResult.value;
	try {
		signal?.throwIfAborted();
		const canvas = new OffscreenCanvas(originalBitmap.width, originalBitmap.height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('This browser cannot restore the original image resolution.');
		context.drawImage(originalBitmap, 0, 0);
		context.globalCompositeOperation = 'destination-in';
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(processedBitmap, 0, 0, canvas.width, canvas.height);
		signal?.throwIfAborted();
		return await canvas.convertToBlob({ type: 'image/png' });
	} finally {
		originalBitmap.close();
		processedBitmap.close();
	}
}
