export interface BackgroundRemovalProgress {
	stage: string;
	progress: number;
}

export function resolveBackgroundRemovalPublicPath(
	publicPath: string,
	currentLocation: string
): string {
	return new URL(publicPath.endsWith('/') ? publicPath : `${publicPath}/`, currentLocation).href;
}

export class ImageEditorBackgroundRemoval {
	private worker: Worker | null = null;
	private pendingReject: ((reason?: unknown) => void) | null = null;
	private pending = false;

	async remove(
		image: Blob,
		publicPath = '/image-editor-models/',
		onProgress?: (progress: BackgroundRemovalProgress) => void
	): Promise<Blob> {
		if (this.pending) {
			throw new Error('Background removal is already running.');
		}
		const optimized = await optimizeLargeInput(image, onProgress);
		const worker = this.ensureWorker();
		const resolvedPublicPath = resolveBackgroundRemovalPublicPath(publicPath, window.location.href);
		this.pending = true;
		return await new Promise<Blob>((resolve, reject) => {
			this.pendingReject = reject;
			worker.onmessage = (event) => {
				const message = event.data as
					| { type: 'progress'; key: string; progress: number }
					| { type: 'complete'; result: Blob }
					| { type: 'error'; message: string };
				if (message.type === 'progress') {
					onProgress?.({ stage: message.key, progress: message.progress });
				}
				if (message.type === 'complete') {
					this.pending = false;
					this.pendingReject = null;
					resolve(message.result);
				}
				if (message.type === 'error') {
					this.pending = false;
					this.pendingReject = null;
					reject(new Error(message.message));
				}
			};
			worker.onerror = (event) => {
				this.pending = false;
				this.pendingReject = null;
				this.worker = null;
				worker.terminate();
				reject(new Error(event.message || 'Background removal worker failed.'));
			};
			worker.postMessage({
				type: 'remove',
				image: optimized,
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
		if (this.pending) {
			this.pendingReject?.(new DOMException('Background removal was canceled.', 'AbortError'));
		}
		this.worker?.terminate();
		this.worker = null;
		this.pending = false;
		this.pendingReject = null;
	}

	dispose(): void {
		this.cancel();
	}
}

async function optimizeLargeInput(
	image: Blob,
	onProgress?: (progress: BackgroundRemovalProgress) => void
): Promise<Blob> {
	const bitmap = await createImageBitmap(image);
	const maxDimension = 4096;
	if (bitmap.width <= maxDimension && bitmap.height <= maxDimension) {
		bitmap.close();
		return image;
	}
	onProgress?.({ stage: 'Preparing an optimized processing copy', progress: 0 });
	const scale = Math.min(maxDimension / bitmap.width, maxDimension / bitmap.height);
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
	onProgress?.({ stage: 'Preparing an optimized processing copy', progress: 1 });
	return await canvas.convertToBlob({ type: 'image/png' });
}
