import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BACKGROUND_REMOVAL_MAX_INPUT_BYTES,
	ImageEditorBackgroundRemoval,
	prepareBackgroundRemovalInput,
	resolveBackgroundRemovalPublicPath,
	restoreOriginalResolution
} from './background-removal';

afterEach(() => vi.unstubAllGlobals());

describe('OpenPost Image Editor background removal', () => {
	it('resolves the bundled root-relative model path against the current app URL', () => {
		expect(
			resolveBackgroundRemovalPublicPath(
				'/image-editor-models/',
				'https://app.example.com/image-editor/design-1'
			)
		).toBe('https://app.example.com/image-editor-models/');
	});

	it('normalizes operator overrides with a trailing slash', () => {
		expect(
			resolveBackgroundRemovalPublicPath(
				'https://models.example.test/openpost',
				'https://app.example.com/'
			)
		).toBe('https://models.example.test/openpost/');
	});

	it('rejects inputs above the explicit browser memory limit before decoding', async () => {
		const createImageBitmap = vi.fn();
		vi.stubGlobal('createImageBitmap', createImageBitmap);

		await expect(
			prepareBackgroundRemovalInput({ size: BACKGROUND_REMOVAL_MAX_INPUT_BYTES + 1 } as Blob)
		).rejects.toThrow('smaller than 25 MB');
		expect(createImageBitmap).not.toHaveBeenCalled();
	});

	it('restores a processed mask over the original RGB pixels at original dimensions', async () => {
		const closeOriginal = vi.fn();
		const closeProcessed = vi.fn();
		const original = new Blob(['original']);
		const processed = new Blob(['processed']);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async (blob: Blob) =>
				blob === original
					? { width: 6000, height: 4000, close: closeOriginal }
					: { width: 4096, height: 2731, close: closeProcessed }
			)
		);
		const drawImage = vi.fn();
		const context = {
			drawImage,
			globalCompositeOperation: 'source-over',
			imageSmoothingEnabled: false,
			imageSmoothingQuality: 'low'
		};
		const output = new Blob(['png'], { type: 'image/png' });
		const canvases: Array<{ width: number; height: number }> = [];
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				constructor(
					readonly width: number,
					readonly height: number
				) {
					canvases.push(this);
				}
				getContext() {
					return context;
				}
				async convertToBlob() {
					return output;
				}
			}
		);

		await expect(restoreOriginalResolution(original, processed)).resolves.toBe(output);
		expect(canvases).toEqual([{ width: 6000, height: 4000 }]);
		expect(drawImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ width: 6000 }), 0, 0);
		expect(drawImage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ width: 4096 }),
			0,
			0,
			6000,
			4000
		);
		expect(context.globalCompositeOperation).toBe('destination-in');
		expect(context.imageSmoothingQuality).toBe('high');
		expect(closeOriginal).toHaveBeenCalledOnce();
		expect(closeProcessed).toHaveBeenCalledOnce();
	});

	it('stops before compositing when cancellation is already requested', async () => {
		const createImageBitmap = vi.fn();
		vi.stubGlobal('createImageBitmap', createImageBitmap);
		const controller = new AbortController();
		controller.abort();

		await expect(
			restoreOriginalResolution(new Blob(), new Blob(), controller.signal)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(createImageBitmap).not.toHaveBeenCalled();
	});

	it('closes a decoded bitmap when the other image cannot be decoded', async () => {
		const closeOriginal = vi.fn();
		const original = new Blob(['original']);
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async (blob: Blob) => {
				if (blob === original) return { width: 10, height: 10, close: closeOriginal };
				throw new Error('processed image is invalid');
			})
		);

		await expect(restoreOriginalResolution(original, new Blob(['invalid']))).rejects.toThrow(
			'processed image is invalid'
		);
		expect(closeOriginal).toHaveBeenCalledOnce();
	});

	it('terminates active inference and rejects it as canceled', async () => {
		const close = vi.fn();
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 1200, height: 800, close }))
		);
		vi.stubGlobal('window', {
			location: { href: 'https://openpost.test/tools/background-remover' }
		});
		vi.stubGlobal('navigator', {});
		const terminate = vi.fn();
		const postMessage = vi.fn();
		class WorkerStub {
			onmessage: ((event: MessageEvent) => void) | null = null;
			onerror: ((event: ErrorEvent) => void) | null = null;
			postMessage = postMessage;
			terminate = terminate;
		}
		vi.stubGlobal('Worker', WorkerStub);
		const removal = new ImageEditorBackgroundRemoval();
		const result = removal.remove(new Blob(['image']));
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());

		removal.cancel();

		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		expect(terminate).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});
});
