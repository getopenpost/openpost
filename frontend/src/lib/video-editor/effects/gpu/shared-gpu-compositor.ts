/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- Shared compositor wraps browser-owned WebGL canvas */
import { createGpuCompositor, type GpuCompositor } from './compositor';

type SharedCanvas = HTMLCanvasElement | OffscreenCanvas;

let sharedCanvas: SharedCanvas | null = null;
let sharedCompositor: GpuCompositor | null = null;
let contextLostListener: ((event: Event) => void) | null = null;
let refCount = 0;

function isContextLost(canvas: SharedCanvas): boolean {
	try {
		const gl = (canvas as HTMLCanvasElement).getContext('webgl2') as WebGL2RenderingContext | null;
		return gl?.isContextLost?.() === true;
	} catch {
		return false;
	}
}

function createShared(): { compositor: GpuCompositor; canvas: SharedCanvas } | null {
	const canvas: SharedCanvas =
		typeof OffscreenCanvas === 'function'
			? new OffscreenCanvas(1, 1)
			: (() => {
					const c = document.createElement('canvas');
					c.width = 1;
					c.height = 1;
					return c;
				})();
	const compositor = createGpuCompositor(canvas);
	if (!compositor) return null;
	sharedCanvas = canvas;
	sharedCompositor = compositor;
	contextLostListener = (event: Event) => {
		event.preventDefault();
		sharedCompositor = null;
		sharedCanvas = null;
		contextLostListener = null;
	};
	canvas.addEventListener('webglcontextlost', contextLostListener);
	return { compositor, canvas };
}

export function acquireSharedGpuCompositor(): {
	compositor: GpuCompositor;
	canvas: SharedCanvas;
} | null {
	if (sharedCompositor && sharedCanvas) {
		const gl = (sharedCompositor as unknown as { gl?: WebGL2RenderingContext }).gl;
		if (gl && gl.isContextLost?.()) {
			if (sharedCanvas && contextLostListener) {
				sharedCanvas.removeEventListener('webglcontextlost', contextLostListener);
			}
			sharedCompositor.dispose();
			sharedCompositor = null;
			sharedCanvas = null;
			contextLostListener = null;
		} else if (sharedCompositor) {
			refCount++;
			return { compositor: sharedCompositor, canvas: sharedCanvas };
		}
	}
	const created = createShared();
	if (!created) return null;
	refCount++;
	return created;
}

export function releaseSharedGpuCompositor(): void {
	refCount = Math.max(0, refCount - 1);
	if (refCount === 0) {
		// Keep shared alive for reuse; do not dispose immediately to preserve compiled programs and pooled textures.
		// Explicit clear is via disposeSharedGpuCompositor().
	}
}

export function disposeSharedGpuCompositor(): void {
	if (sharedCanvas && contextLostListener) {
		sharedCanvas.removeEventListener('webglcontextlost', contextLostListener);
	}
	if (sharedCompositor) {
		sharedCompositor.dispose();
	}
	sharedCompositor = null;
	sharedCanvas = null;
	contextLostListener = null;
	refCount = 0;
}

export function sharedGpuCompositorStats(): { alive: boolean; refCount: number } {
	return { alive: sharedCompositor !== null, refCount };
}
