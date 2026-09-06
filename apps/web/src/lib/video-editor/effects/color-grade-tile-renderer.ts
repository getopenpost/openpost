import { createGpuCompositor, type GpuRenderEffect } from './gpu/compositor';

interface TilePipeline {
	canvas: HTMLCanvasElement;
	compositor: NonNullable<ReturnType<typeof createGpuCompositor>>;
}

let pipeline: TilePipeline | null | undefined;
let queueTail: Promise<unknown> = Promise.resolve();
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const IMAGE_CACHE_LIMIT = 64;

function getPipeline(): TilePipeline | null {
	if (pipeline !== undefined) return pipeline;
	if (typeof document === 'undefined') return (pipeline = null);
	const canvas = document.createElement('canvas');
	const compositor = createGpuCompositor(canvas);
	pipeline = compositor ? { canvas, compositor } : null;
	return pipeline;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
	const cached = imageCache.get(url);
	if (cached) {
		imageCache.delete(url);
		imageCache.set(url, cached);
		return cached;
	}
	const request = new Promise<HTMLImageElement | null>((resolve) => {
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => resolve(image);
		image.onerror = () => resolve(null);
		image.src = url;
	});
	imageCache.set(url, request);
	while (imageCache.size > IMAGE_CACHE_LIMIT) {
		const oldest = imageCache.keys().next().value;
		if (oldest === undefined) break;
		imageCache.delete(oldest);
	}
	return request;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = queueTail.then(task, task);
	queueTail = run.catch(() => undefined);
	return run;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

/** Bake the real ordered GPU effect stack into a small filmstrip frame. */
export async function renderColorGradeTile(
	frameUrl: string,
	effects: readonly GpuRenderEffect[],
	maxDimension = 256
): Promise<Blob | null> {
	if (effects.length === 0 || maxDimension < 2) return null;
	const renderer = getPipeline();
	if (!renderer) return null;
	const image = await loadImage(frameUrl);
	if (!image || image.naturalWidth < 2 || image.naturalHeight < 2) return null;

	const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
	const width = Math.max(2, Math.round(image.naturalWidth * scale));
	const height = Math.max(2, Math.round(image.naturalHeight * scale));
	return enqueue(async () => {
		try {
			if (!renderer.compositor.render(image, width, height, effects)) return null;
			return await canvasBlob(renderer.canvas);
		} catch {
			return null;
		}
	});
}
