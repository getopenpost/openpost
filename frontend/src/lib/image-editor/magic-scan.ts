import { scanMagicPixels, type MagicPixelScanInput } from './magic-scan-core';

const WORKER_PIXEL_THRESHOLD = 1_048_576;
export const MAXIMUM_MAGIC_SCAN_PIXELS = 32_000_000;

export class ImageEditorMagicScan {
	private worker: Worker | null = null;
	private activeID = '';

	async scan(
		input: MagicPixelScanInput,
		options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
	): Promise<Uint8Array> {
		const pixels = input.width * input.height;
		if (pixels > MAXIMUM_MAGIC_SCAN_PIXELS) {
			throw new RangeError(
				`Pixel scan exceeds the ${MAXIMUM_MAGIC_SCAN_PIXELS} pixel safety limit.`
			);
		}
		this.cancel();
		const id = crypto.randomUUID();
		this.activeID = id;
		if (typeof Worker === 'undefined' || pixels < WORKER_PIXEL_THRESHOLD) {
			return scanMagicPixels(input, {
				shouldCancel: () => options.signal?.aborted === true || this.activeID !== id,
				onProgress: options.onProgress
			});
		}
		const worker = new Worker(new URL('./magic-scan.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker = worker;
		return new Promise<Uint8Array>((resolve, reject) => {
			const abort = () => worker.postMessage({ type: 'cancel', id });
			const finish = (complete: () => void): void => {
				options.signal?.removeEventListener('abort', abort);
				worker.terminate();
				if (this.worker === worker) this.worker = null;
				if (this.activeID === id) this.activeID = '';
				complete();
			};
			options.signal?.addEventListener('abort', abort, { once: true });
			worker.onmessage = (event: MessageEvent) => {
				if (event.data?.id !== id) return;
				if (event.data.type === 'progress') options.onProgress?.(event.data.fraction);
				if (event.data.type === 'complete') finish(() => resolve(event.data.mask));
				if (event.data.type === 'error') {
					finish(() =>
						reject(
							event.data.name === 'AbortError'
								? new DOMException(event.data.message, 'AbortError')
								: new Error(event.data.message)
						)
					);
				}
			};
			worker.onerror = () => finish(() => reject(new Error('Pixel scan worker failed.')));
			if (options.signal?.aborted) {
				finish(() => reject(new DOMException('Pixel scan cancelled.', 'AbortError')));
				return;
			}
			worker.postMessage({ type: 'scan', id, ...input }, [input.data.buffer as ArrayBuffer]);
		});
	}

	cancel(): void {
		if (this.worker && this.activeID)
			this.worker.postMessage({ type: 'cancel', id: this.activeID });
		this.activeID = '';
	}

	dispose(): void {
		this.cancel();
		this.worker?.terminate();
		this.worker = null;
	}
}
