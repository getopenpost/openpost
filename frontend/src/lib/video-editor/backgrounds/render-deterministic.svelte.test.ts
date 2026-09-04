import { describe, expect, it } from 'vitest';
import { renderBackgroundCpu } from './render';
import type { ProceduralBackground } from './types';

interface CanvasWithContext {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function makeCanvas(w: number, h: number): CanvasWithContext {
	const hasOff = typeof OffscreenCanvas !== 'undefined';
	const c: HTMLCanvasElement | OffscreenCanvas = hasOff
		? new OffscreenCanvas(w, h)
		: (() => {
				const el = document.createElement('canvas');
				el.width = w;
				el.height = h;
				return el;
			})();
	if (c instanceof OffscreenCanvas) {
		c.width = w;
		c.height = h;
	}
	const ctx = c.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2d unavailable');
	return { canvas: c, ctx };
}

function readPixels(canvas: HTMLCanvasElement | OffscreenCanvas): Uint8Array {
	if (canvas instanceof OffscreenCanvas) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error('2d unavailable');
		return new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
	}
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2d unavailable');
	return new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

describe('procedural background deterministic rendering', () => {
	it('mesh gradient is deterministic across calls and identical at same resolution', () => {
		const bg: ProceduralBackground = {
			kind: 'mesh-gradient',
			colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
			smoothness: 0.6,
			rotation: 15,
			scale: 1,
			offsetX: 0.05,
			offsetY: -0.03
		};
		const w = 128,
			h = 72;
		const { canvas: c1, ctx: ctx1 } = makeCanvas(w, h);
		const { canvas: c2, ctx: ctx2 } = makeCanvas(w, h);
		renderBackgroundCpu(ctx1, bg, w, h);
		renderBackgroundCpu(ctx2, bg, w, h);
		expect(readPixels(c1)).toEqual(readPixels(c2));
		renderBackgroundCpu(ctx1, bg, w, h);
		expect(readPixels(c1)).toEqual(readPixels(c2));
	});
});
