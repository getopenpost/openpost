/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- GPU pool manages browser-owned WebGL and canvas resources with explicit size/cap checks */
/** Bounded reusable GPU texture/framebuffer pool shared by preview and export. */

import { ignoreCleanupError } from '$lib/cleanup';

export interface PooledGpuEntry {
	texture: WebGLTexture;
	framebuffer: WebGLFramebuffer;
	width: number;
	height: number;
	bytes: number;
}

const BYTES_PER_PIXEL = 4;
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;
const DEFAULT_MAX_COUNT = 8;

function bytesFor(width: number, height: number): number {
	return width * height * BYTES_PER_PIXEL;
}

export class GpuResourcePool {
	private readonly pools = new WeakMap<WebGL2RenderingContext, PooledGpuEntry[]>();
	private readonly bytesForContext = new WeakMap<WebGL2RenderingContext, number>();
	private contexts = new Set<WebGL2RenderingContext>();
	maxBytes = DEFAULT_MAX_BYTES;
	maxCount = DEFAULT_MAX_COUNT;

	acquire(gl: WebGL2RenderingContext, width: number, height: number): PooledGpuEntry | null {
		const list = this.pools.get(gl);
		if (!list || list.length === 0) return null;
		const index = list.findIndex((entry) => entry.width === width && entry.height === height);
		if (index === -1) return null;
		const [entry] = list.splice(index, 1);
		if (!entry) return null;
		this.bytesForContext.set(gl, (this.bytesForContext.get(gl) ?? 0) - entry.bytes);
		if (isContextLost(gl)) {
			disposeGpuEntry(gl, entry);
			return null;
		}
		clearTexturePixels(gl, entry);
		return entry;
	}

	private hasCapacity(
		gl: WebGL2RenderingContext,
		list: PooledGpuEntry[],
		incomingBytes: number
	): boolean {
		return (
			list.length < this.maxCount &&
			(this.bytesForContext.get(gl) ?? 0) + incomingBytes <= this.maxBytes
		);
	}

	private evictOldest(gl: WebGL2RenderingContext, list: PooledGpuEntry[]): boolean {
		const oldest = list.shift();
		if (!oldest) return false;
		disposeGpuEntry(gl, oldest);
		this.bytesForContext.set(gl, (this.bytesForContext.get(gl) ?? 0) - oldest.bytes);
		return true;
	}

	release(gl: WebGL2RenderingContext, entry: PooledGpuEntry): boolean {
		if (isContextLost(gl)) {
			disposeGpuEntry(gl, entry);
			return false;
		}
		const list = this.pools.get(gl) ?? [];
		if (!this.hasCapacity(gl, list, entry.bytes)) {
			const freed = this.evictOldest(gl, list);
			if (!freed || !this.hasCapacity(gl, list, entry.bytes)) {
				disposeGpuEntry(gl, entry);
				if (list.length === 0) {
					this.pools.delete(gl);
					this.bytesForContext.delete(gl);
					this.contexts.delete(gl);
				} else {
					this.pools.set(gl, list);
				}
				return false;
			}
		}
		clearTexturePixels(gl, entry);
		list.push(entry);
		this.pools.set(gl, list);
		this.bytesForContext.set(gl, (this.bytesForContext.get(gl) ?? 0) + entry.bytes);
		this.contexts.add(gl);
		return true;
	}

	/** Remove and delete every retained entry for a single context. */
	clearForContext(gl: WebGL2RenderingContext): void {
		const list = this.pools.get(gl);
		if (!list) return;
		for (const entry of list) {
			if (!isContextLost(gl)) disposeGpuEntry(gl, entry);
		}
		this.pools.delete(gl);
		this.bytesForContext.delete(gl);
		this.contexts.delete(gl);
	}

	/** Delete all retained entries across all contexts still alive. */
	clearAll(): void {
		for (const gl of [...this.contexts]) {
			this.clearForContext(gl);
		}
	}

	countFor(gl: WebGL2RenderingContext): number {
		return this.pools.get(gl)?.length ?? 0;
	}

	bytesRetainedFor(gl: WebGL2RenderingContext): number {
		return this.bytesForContext.get(gl) ?? 0;
	}

	static bytesForSize(width: number, height: number): number {
		return bytesFor(width, height);
	}
}

function isContextLost(gl: WebGL2RenderingContext): boolean {
	return (gl as unknown as { isContextLost?: () => boolean }).isContextLost?.() === true;
}

function disposeGpuEntry(gl: WebGL2RenderingContext, entry: PooledGpuEntry): void {
	ignoreCleanupError(() => gl.deleteTexture(entry.texture));
	ignoreCleanupError(() => gl.deleteFramebuffer(entry.framebuffer));
}

function clearTexturePixels(gl: WebGL2RenderingContext, entry: PooledGpuEntry): void {
	ignoreCleanupError(() => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, entry.framebuffer);
		gl.viewport(0, 0, entry.width, entry.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	});
}

export const gpuResourcePool = new GpuResourcePool();

/** Simple bounded pool for OffscreenCanvas/HTMLCanvasElement reuse. */
export interface PooledCanvas {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	width: number;
	height: number;
}

export class CanvasPool {
	private entries: PooledCanvas[] = [];
	private totalBytes = 0;
	maxBytes = 64 * 1024 * 1024;
	maxCount = 6;

	acquire(width: number, height: number): PooledCanvas | null {
		const index = this.entries.findIndex(
			(entry) => entry.width === width && entry.height === height
		);
		if (index === -1) return null;
		const [entry] = this.entries.splice(index, 1);
		if (!entry) return null;
		this.totalBytes -= entry.width * entry.height * BYTES_PER_PIXEL;
		clearCanvasPixels(entry.canvas, width, height);
		return entry;
	}

	release(canvas: HTMLCanvasElement | OffscreenCanvas): boolean {
		const width = canvas.width;
		const height = canvas.height;
		const bytes = width * height * BYTES_PER_PIXEL;
		if (this.entries.length >= this.maxCount || this.totalBytes + bytes > this.maxBytes) {
			let evicted = false;
			if (this.entries.length > 0) {
				const oldest = this.entries.shift();
				if (oldest) {
					this.totalBytes -= oldest.width * oldest.height * BYTES_PER_PIXEL;
					evicted = true;
				}
			}
			if (
				!evicted ||
				this.entries.length >= this.maxCount ||
				this.totalBytes + bytes > this.maxBytes
			) {
				return false;
			}
		}
		clearCanvasPixels(canvas, width, height);
		this.entries.push({ canvas, width, height });
		this.totalBytes += bytes;
		return true;
	}

	clear(): void {
		this.entries.length = 0;
		this.totalBytes = 0;
	}

	count(): number {
		return this.entries.length;
	}

	bytesRetained(): number {
		return this.totalBytes;
	}
}

function clearCanvasPixels(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	width: number,
	height: number
): void {
	ignoreCleanupError(() => {
		const ctx = canvas.getContext('2d') as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!ctx) return;
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(ctx as any).filter = 'none';
		ctx.clearRect(0, 0, width, height);
	});
}

export const canvasPool = new CanvasPool();
