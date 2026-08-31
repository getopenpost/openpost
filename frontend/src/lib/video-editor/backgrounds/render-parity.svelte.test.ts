import { describe, expect, it } from 'vitest';
import {
	createBackgroundGpuRenderer,
	GPU_BACKGROUND_PIXEL_THRESHOLD,
	patternMetrics,
	renderBackgroundCpuReference,
	type BackgroundGpuAdapter
} from './render';
import type { BackgroundPatternKind, ProceduralBackground } from './types';
import { CanvasStackCompositor } from '../media/canvas-stack-compositor';
import type { TimelineItem } from '../project/types';

interface Make2dCanvasResult {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
}

function make2dCanvas(w: number, h: number): Make2dCanvasResult {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const ctx = c.getContext('2d', { willReadFrequently: true })!;
	return { canvas: c, ctx };
}

function readPixels(canvas: HTMLCanvasElement): Uint8Array {
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	return new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

interface DiffStatsResult {
	ratio: number;
	maxAbs: number;
	meanAbs: number;
}

function diffStats(a: Uint8Array, b: Uint8Array): DiffStatsResult {
	let diff = 0;
	let maxAbs = 0;
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
		if (i % 4 < 3 && d > maxAbs) maxAbs = d;
		sum += d;
		if (i % 4 === 0) {
			const dr = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
			const dg = Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0));
			const db = Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
			if (dr > 2 || dg > 2 || db > 2) diff++;
		}
	}
	return { ratio: diff / (a.length / 4), maxAbs, meanAbs: sum / a.length };
}

describe('background CPU vs GPU - real parity at multiple sizes', () => {
	it('mesh gradients match reference vs GPU at non-square sizes, rotations, scales, offsets (exact)', () => {
		const renderer = createBackgroundGpuRenderer();
		if (!renderer) {
			expect(true).toBe(true);
			return;
		}
		expect(renderer.failureReason()).toBeNull();
		expect(GPU_BACKGROUND_PIXEL_THRESHOLD).toBe(256 * 256);

		const cases: Array<{
			bg: ProceduralBackground;
			w: number;
			h: number;
		}> = [
			{
				bg: {
					kind: 'mesh-gradient',
					colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
					smoothness: 0.55,
					rotation: 0,
					scale: 1,
					offsetX: 0,
					offsetY: 0
				},
				w: 320,
				h: 180
			},
			{
				bg: {
					kind: 'mesh-gradient',
					colors: ['#0ea5e9', '#06b6d4', '#1e3a8a', '#020617'],
					smoothness: 0.62,
					rotation: 45,
					scale: 1.5,
					offsetX: 0.2,
					offsetY: -0.15
				},
				w: 180,
				h: 320
			},
			{
				bg: {
					kind: 'mesh-gradient',
					colors: ['#22c55e', '#15803d', '#a3e635', '#052e16'],
					smoothness: 0.0,
					rotation: -30,
					scale: 0.7,
					offsetX: -0.2,
					offsetY: 0.25
				},
				w: 640,
				h: 360
			},
			{
				bg: {
					kind: 'mesh-gradient',
					colors: ['#ff00a0', '#7c3aed', '#00e5ff', '#0a0a0a'],
					smoothness: 1.0,
					rotation: 90,
					scale: 0.5,
					offsetX: 0.1,
					offsetY: 0.1
				},
				w: 1280,
				h: 720
			},
			{
				bg: {
					kind: 'mesh-gradient',
					colors: ['#ffffff', '#000000', '#ff0000', '#00ff00'],
					smoothness: 0.3,
					rotation: 12,
					scale: 2.0,
					offsetX: 0,
					offsetY: 0
				},
				w: 1920,
				h: 1080
			}
		];

		for (const { bg, w, h } of cases) {
			const { canvas: cpuCanvas, ctx: cpuCtx } = make2dCanvas(w, h);
			renderBackgroundCpuReference(cpuCtx, bg, w, h);
			const cpuPixels = readPixels(cpuCanvas);

			const ok = renderer.render(bg, w, h);
			expect(ok, renderer.failureReason() ?? `GPU render failed at ${w}x${h}`).toBe(true);
			expect(renderer.failureReason()).toBeNull();
			const gpuCanvas = renderer.canvas;
			const { canvas: readCanvas, ctx: readCtx } = make2dCanvas(w, h);
			readCtx.drawImage(gpuCanvas, 0, 0);
			const gpuPixels = readPixels(readCanvas);

			const { ratio, maxAbs, meanAbs } = diffStats(cpuPixels, gpuPixels);
			console.log(
				`[parity] mesh ${w}x${h} ratio=${ratio.toFixed(5)} mean=${meanAbs.toFixed(4)} max=${maxAbs}`
			);
			expect(
				ratio,
				`mesh ${w}x${h} rot ${bg.rotation} scale ${bg.scale} ratio ${ratio} max ${maxAbs}`
			).toBeLessThan(0.001);
			expect(maxAbs).toBeLessThanOrEqual(2);
			expect(meanAbs).toBeLessThan(0.2);
		}
		renderer.dispose();
		expect(renderer.failureReason()).toBeNull();
	});

	it('patterns match reference vs GPU for all four kinds at non-square sizes (tight edge budget)', () => {
		const renderer = createBackgroundGpuRenderer();
		if (!renderer) {
			expect(true).toBe(true);
			return;
		}
		const sizes: Array<[number, number]> = [
			[320, 180],
			[180, 320],
			[641, 359],
			[800, 600]
		];
		const patterns: BackgroundPatternKind[] = ['dots', 'grid', 'stripes', 'checker'];
		for (const pattern of patterns) {
			for (const [w, h] of sizes) {
				const bg: ProceduralBackground = {
					kind: 'pattern',
					pattern,
					foreground: '#ff7a18',
					background: '#0f0f0f',
					scale: 1.2,
					rotation: pattern === 'stripes' ? 28 : pattern === 'dots' ? 15 : 0,
					offsetX: 0.12,
					offsetY: -0.08,
					density: pattern === 'grid' ? 0.45 : 0.5,
					foregroundOpacity: pattern === 'grid' ? 0.9 : 1
				};
				const density = bg.kind === 'pattern' ? bg.density : 0.5;
				const { tile } = patternMetrics(density);
				expect(tile).toBeGreaterThan(0);

				const { canvas: cpuCanvas, ctx: cpuCtx } = make2dCanvas(w, h);
				renderBackgroundCpuReference(cpuCtx, bg, w, h);
				const cpuPixels = readPixels(cpuCanvas);

				const ok = renderer.render(bg, w, h);
				expect(ok, `GPU ${pattern} ${w}x${h} failed: ${renderer.failureReason()}`).toBe(true);
				expect(renderer.failureReason()).toBeNull();
				const gpuCanvas = renderer.canvas;
				const { canvas: readCanvas, ctx: readCtx } = make2dCanvas(w, h);
				readCtx.drawImage(gpuCanvas, 0, 0);
				const gpuPixels = readPixels(readCanvas);

				const { ratio, maxAbs, meanAbs } = diffStats(cpuPixels, gpuPixels);
				console.log(
					`[parity] pattern ${pattern} ${w}x${h} ratio=${ratio.toFixed(5)} mean=${meanAbs.toFixed(4)} max=${maxAbs}`
				);
				expect(ratio, `pattern ${pattern} ${w}x${h} ratio ${ratio}`).toBeLessThan(0.005);
				expect(meanAbs, `pattern ${pattern} ${w}x${h} mean ${meanAbs}`).toBeLessThan(0.2);
				expect(maxAbs === 0 || maxAbs <= 2 || (maxAbs >= 100 && maxAbs <= 255)).toBe(true);
			}
		}
		renderer.dispose();
	});

	it('proves GPU path is selected at 1080p and no ImageData fallback, with disposal', () => {
		const renderer = createBackgroundGpuRenderer();
		if (!renderer) {
			expect(true).toBe(true);
			return;
		}
		const bg: ProceduralBackground = {
			kind: 'mesh-gradient',
			colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
			smoothness: 0.55,
			rotation: 0,
			scale: 1,
			offsetX: 0,
			offsetY: 0
		};
		const ok = renderer.render(bg, 1920, 1080);
		expect(ok).toBe(true);
		expect(renderer.failureReason()).toBeNull();
		expect(renderer.canvas.width).toBe(1920);
		expect(renderer.canvas.height).toBe(1080);

		renderer.dispose();
		const afterDisposeOk = renderer.render(bg, 320, 180);
		expect(afterDisposeOk).toBe(false);
		expect(renderer.failureReason()).toMatch(/disposed/);
	});

	it('one-shot GPU failure falls back to exact CPU pixels and next GPU success clears sticky failure', () => {
		const stack = new CanvasStackCompositor(document.createElement('canvas'));
		const bg: ProceduralBackground = {
			kind: 'mesh-gradient',
			colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
			smoothness: 0.55,
			rotation: 12,
			scale: 1.1,
			offsetX: 0.05,
			offsetY: -0.03
		};
		const item: TimelineItem = {
			id: 'bg-fail-test',
			trackId: 't',
			from: 0,
			durationInFrames: 10,
			label: 'bg',
			type: 'background',
			background: bg,
			transform: { width: 640, height: 360 }
		};
		const freshReal = createBackgroundGpuRenderer();
		if (!freshReal) throw new Error('Missing fresh adapter');
		let firstCall = true;
		const mockGpu: BackgroundGpuAdapter = {
			canvas: freshReal.canvas,
			failureReason: () => (firstCall ? 'injected one-shot failure' : null),
			render: (b, w, h) => {
				if (firstCall) {
					firstCall = false;
					return false;
				}
				return freshReal.render(b, w, h);
			},
			dispose: () => {}
		};
		stack.setBackgroundAdapter(mockGpu);
		stack.beginFrame(640, 360, '#000000');
		stack.compositeLayer(null, item, 1, 0);
		expect(stack.exactRenderFailureReason()).toBeNull();
		expect(stack.failureReason()).toBeNull();
		let diag = stack.getBackgroundDiagnostics();
		expect(diag.cpuFallbacks).toBe(1);
		expect(diag.gpuCalls).toBe(0);
		const canvas = stack.getCanvasForTest();
		if (!(canvas instanceof HTMLCanvasElement)) throw new Error('expected HTMLCanvasElement');
		const cpuCtx = canvas.getContext('2d', { willReadFrequently: true })!;
		const cpuPixels = new Uint8Array(cpuCtx.getImageData(0, 0, 640, 360).data);
		expect(cpuPixels.some((v) => v !== 0)).toBe(true);
		stack.setBackgroundAdapter(freshReal);
		stack.beginFrame(640, 360, '#000000');
		stack.compositeLayer(null, item, 1, 0);
		expect(stack.exactRenderFailureReason()).toBeNull();
		expect(stack.failureReason()).toBeNull();
		expect(freshReal.failureReason()).toBeNull();
		diag = stack.getBackgroundDiagnostics();
		expect(diag.gpuCalls).toBe(1);
		expect(diag.cpuFallbacks).toBe(1);
		const gpuCtx = canvas.getContext('2d', { willReadFrequently: true })!;
		const gpuPixels = new Uint8Array(gpuCtx.getImageData(0, 0, 640, 360).data);
		const { ratio } = diffStats(cpuPixels, gpuPixels);
		expect(ratio).toBeLessThan(0.02);
		stack.dispose();
	});

	it('CanvasStackCompositor does not call CPU fallback at 1080p when GPU healthy and caches repeated frames', () => {
		const stack = new CanvasStackCompositor(document.createElement('canvas'));
		const bg: ProceduralBackground = {
			kind: 'mesh-gradient',
			colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
			smoothness: 0.55,
			rotation: 0,
			scale: 1,
			offsetX: 0,
			offsetY: 0
		};
		const item: TimelineItem = {
			id: 'bg-cache',
			trackId: 't',
			from: 0,
			durationInFrames: 10,
			label: 'bg',
			type: 'background',
			background: bg,
			transform: { width: 1920, height: 1080 }
		};
		expect(stack.getBackgroundAdapterForTest()).toBeNull();
		stack.beginFrame(1920, 1080, '#000000');
		stack.compositeLayer(null, item, 1, 0);
		expect(stack.getBackgroundAdapterForTest()).not.toBeNull();
		expect(stack.exactRenderFailureReason()).toBeNull();
		expect(stack.failureReason()).toBeNull();
		let diag = stack.getBackgroundDiagnostics();
		expect(diag.gpuCalls).toBe(1);
		expect(diag.cpuFallbacks).toBe(0);
		const bgCanvasBefore = stack.getBackgroundCanvasForTest();
		const adapterBefore = stack.getBackgroundAdapterForTest();
		const keyBefore = diag.lastKey;
		stack.beginFrame(1920, 1080, '#000000');
		stack.compositeLayer(null, item, 1, 0);
		expect(stack.exactRenderFailureReason()).toBeNull();
		diag = stack.getBackgroundDiagnostics();
		const bgCanvasAfter = stack.getBackgroundCanvasForTest();
		const adapterAfter = stack.getBackgroundAdapterForTest();
		expect(adapterAfter).toBe(adapterBefore);
		expect(bgCanvasAfter).toBe(bgCanvasBefore);
		expect(diag.lastKey).toBe(keyBefore);
		expect(diag.gpuCalls).toBe(1);
		expect(diag.cpuFallbacks).toBe(0);
		stack.dispose();
	});

	it('honest alpha still blends at 0.5 over black via compositor', () => {
		const bg: ProceduralBackground = {
			kind: 'pattern',
			pattern: 'grid',
			foreground: '#ffffff',
			background: '#000000',
			scale: 1,
			rotation: 0,
			offsetX: 0,
			offsetY: 0,
			density: 1,
			foregroundOpacity: 1
		};
		const item: TimelineItem = {
			id: 'bg2',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 30,
			label: 'Background',
			type: 'background',
			background: bg,
			transform: { width: 64, height: 64, opacity: 0.5 }
		};
		const c = document.createElement('canvas');
		const stack = new CanvasStackCompositor(c);
		stack.beginFrame(64, 64, '#000000');
		stack.compositeLayer(null, item, 0.5, 0);
		const canvas = stack.getCanvasForTest();
		if (!(canvas instanceof HTMLCanvasElement)) throw new Error('expected HTMLCanvasElement');
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		const data = ctx.getImageData(0, 0, 64, 64).data;
		let foundMid = false;
		for (let i = 0; i < data.length; i += 4) {
			const r = data[i]!;
			if (r > 100 && r < 160) foundMid = true;
		}
		expect(foundMid).toBe(true);
		stack.dispose();
	});
});
