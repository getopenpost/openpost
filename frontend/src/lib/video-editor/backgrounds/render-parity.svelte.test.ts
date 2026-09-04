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
});
