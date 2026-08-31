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

	it('pattern is deterministic and geometry scales with resolution', () => {
		const bg: ProceduralBackground = {
			kind: 'pattern',
			pattern: 'dots',
			foreground: '#ff7a18',
			background: '#0f0f0f',
			scale: 1,
			rotation: 30,
			offsetX: 0,
			offsetY: 0,
			density: 0.5,
			foregroundOpacity: 1
		};
		const { canvas: c1, ctx: ctx1 } = makeCanvas(64, 64);
		const { canvas: c2, ctx: ctx2 } = makeCanvas(64, 64);
		renderBackgroundCpu(ctx1, bg, 64, 64);
		renderBackgroundCpu(ctx2, bg, 64, 64);
		expect(readPixels(c1)).toEqual(readPixels(c2));

		const { canvas: c3, ctx: ctx3 } = makeCanvas(128, 128);
		renderBackgroundCpu(ctx3, bg, 128, 128);
		const p64 = readPixels(c1);
		const p128 = readPixels(c3);
		expect(p128.length).toBeGreaterThan(p64.length);
		const hasFg64 = p64.some((_, i) => i % 4 === 0 && p64[i] === 255 && p64[i + 1] === 122);
		expect(hasFg64).toBe(true);
	});
});
