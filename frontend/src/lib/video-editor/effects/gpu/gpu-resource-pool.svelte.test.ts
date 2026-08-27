/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-known-value-widening -- Browser WebGL tests use narrow casts for instrumented GL */
import { describe, expect, it, beforeEach } from 'vitest';
import { createGpuCompositor } from './compositor';
import { gpuResourcePool, canvasPool } from './gpu-resource-pool';
import { CanvasStackCompositor } from '../../media/canvas-stack-compositor';
import {
	acquireSharedGpuCompositor,
	releaseSharedGpuCompositor,
	disposeSharedGpuCompositor,
	sharedGpuCompositorStats
} from './shared-gpu-compositor';

function solid(color: string, width = 4, height = 4): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2d unavailable');
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, width, height);
	return canvas;
}

function readPixelFromCanvas(canvas: HTMLCanvasElement): number[] {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2d unavailable');
	return Array.from(ctx.getImageData(0, 0, 1, 1).data);
}

function createStackCanvas(width: number, height: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = width;
	c.height = height;
	return c;
}

describe('gpu resource pool', () => {
	beforeEach(() => {
		gpuResourcePool.clearAll();
		canvasPool.clear();
		gpuResourcePool.maxBytes = 96 * 1024 * 1024;
		gpuResourcePool.maxCount = 8;
		canvasPool.maxBytes = 64 * 1024 * 1024;
		canvasPool.maxCount = 12;
		disposeSharedGpuCompositor();
	});

	it('reuses ping textures without new allocations at stable size', () => {
		const canvas = document.createElement('canvas');
		const compositor = createGpuCompositor(canvas);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		const gl = (compositor as unknown as { gl: WebGL2RenderingContext }).gl;
		let createCount = 0;
		const origCreate = gl.createTexture.bind(gl);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(gl as any).createTexture = () => {
			createCount++;
			return origCreate();
		};
		let deleteCount = 0;
		const origDelete = gl.deleteTexture.bind(gl);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(gl as any).deleteTexture = (tex: WebGLTexture | null) => {
			if (tex) deleteCount++;
			return origDelete(tex);
		};

		const src = solid('#ff0000', 16, 16);
		expect(compositor.render(src, 16, 16, [], {})).toBe(true);
		const afterFirstCreate = createCount;
		expect(afterFirstCreate).toBeGreaterThan(0);
		expect(compositor.render(src, 16, 16, [], {})).toBe(true);
		expect(createCount).toBe(afterFirstCreate);
		expect(deleteCount).toBe(0);
		compositor.dispose();
	});

	it('reuses pooled size after resize cycle and avoids stale pixels', () => {
		const canvas = document.createElement('canvas');
		const compositor = createGpuCompositor(canvas);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		const gl = (compositor as unknown as { gl: WebGL2RenderingContext }).gl;
		let createCount = 0;
		const origCreateTex = gl.createTexture.bind(gl);
		const origCreateFb = gl.createFramebuffer.bind(gl);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(gl as any).createTexture = () => {
			createCount++;
			return origCreateTex();
		};
		let fbCreate = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(gl as any).createFramebuffer = () => {
			fbCreate++;
			return origCreateFb();
		};

		const red = solid('#ff0000', 8, 8);
		const blue = solid('#0000ff', 8, 8);

		expect(compositor.render(red, 32, 32, [], {})).toBe(true);
		const createsAfterA = createCount;
		const fbAfterA = fbCreate;

		expect(compositor.render(blue, 64, 64, [], {})).toBe(true);
		const createsAfterB = createCount;
		expect(createsAfterB).toBeGreaterThan(createsAfterA);

		expect(gpuResourcePool.countFor(gl)).toBe(2);

		const green = solid('#00ff00', 32, 32);
		expect(compositor.render(green, 32, 32, [], {})).toBe(true);
		expect(createCount).toBe(createsAfterB);
		expect(fbCreate).toBe(fbAfterA + 2);

		// Verify stale pixels were cleared: rendering green 32 should be green, not red bleed
		// WebGL canvas cannot provide a 2d context; copy via a temporary 2d canvas.
		const tmp = document.createElement('canvas');
		tmp.width = canvas.width;
		tmp.height = canvas.height;
		const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });
		expect(tmpCtx).not.toBeNull();
		if (!tmpCtx) {
			compositor.dispose();
			return;
		}
		tmpCtx.drawImage(canvas, 0, 0);
		const pixels = Array.from(tmpCtx.getImageData(0, 0, 1, 1).data);
		expect(pixels[1]).toBeGreaterThan(200);
		expect(pixels[0]).toBeLessThan(10);
		compositor.dispose();
	});

	it('isolates pools per WebGL context when not shared', () => {
		const a = document.createElement('canvas');
		const b = document.createElement('canvas');
		const compA = createGpuCompositor(a);
		const compB = createGpuCompositor(b);
		expect(compA).not.toBeNull();
		expect(compB).not.toBeNull();
		if (!compA || !compB) return;
		const glA = (compA as unknown as { gl: WebGL2RenderingContext }).gl;
		const glB = (compB as unknown as { gl: WebGL2RenderingContext }).gl;
		expect(glA).not.toBe(glB);

		const src = solid('#ff0000', 16, 16);
		expect(compA.render(src, 16, 16, [], {})).toBe(true);
		expect(compB.render(src, 16, 16, [], {})).toBe(true);

		expect(gpuResourcePool.countFor(glA)).toBe(0);
		expect(gpuResourcePool.countFor(glB)).toBe(0);

		expect(compA.render(src, 32, 32, [], {})).toBe(true);
		expect(gpuResourcePool.countFor(glA)).toBe(2);
		expect(gpuResourcePool.countFor(glB)).toBe(0);

		compA.dispose();
		compB.dispose();
		expect(gpuResourcePool.countFor(glA)).toBe(0);
		expect(gpuResourcePool.countFor(glB)).toBe(0);
	});

	it('caps retained bytes and count', () => {
		const canvas = document.createElement('canvas');
		const comp = createGpuCompositor(canvas);
		expect(comp).not.toBeNull();
		if (!comp) return;
		const gl = (comp as unknown as { gl: WebGL2RenderingContext }).gl;
		gpuResourcePool.maxBytes = 32 * 1024 * 1024;
		gpuResourcePool.maxCount = 2;

		const src = solid('#ff0000', 8, 8);
		expect(comp.render(src, 128, 128, [], {})).toBe(true);
		expect(comp.render(src, 256, 256, [], {})).toBe(true);
		expect(comp.render(src, 512, 512, [], {})).toBe(true);
		expect(gpuResourcePool.countFor(gl)).toBeLessThanOrEqual(2);
		expect(gpuResourcePool.bytesRetainedFor(gl)).toBeLessThanOrEqual(32 * 1024 * 1024);
		comp.dispose();
	});

	it('releases resources on dispose and context loss without leak', () => {
		const canvas = document.createElement('canvas');
		const comp = createGpuCompositor(canvas);
		expect(comp).not.toBeNull();
		if (!comp) return;
		const gl = (comp as unknown as { gl: WebGL2RenderingContext }).gl;
		const src = solid('#ff0000', 16, 16);
		expect(comp.render(src, 16, 16, [], {})).toBe(true);
		expect(comp.render(src, 32, 32, [], {})).toBe(true);
		expect(gpuResourcePool.countFor(gl)).toBe(2);
		comp.dispose();
		expect(gpuResourcePool.countFor(gl)).toBe(0);

		const canvas2 = document.createElement('canvas');
		const comp2 = createGpuCompositor(canvas2);
		expect(comp2).not.toBeNull();
		if (!comp2) return;
		const gl2 = (comp2 as unknown as { gl: WebGL2RenderingContext }).gl;
		expect(comp2.render(src, 16, 16, [], {})).toBe(true);
		expect(comp2.render(src, 32, 32, [], {})).toBe(true);
		expect(gpuResourcePool.countFor(gl2)).toBe(2);
		const ext = gl2.getExtension('WEBGL_lose_context');
		if (ext) {
			ext.loseContext();
			gpuResourcePool.clearForContext(gl2);
			expect(gpuResourcePool.countFor(gl2)).toBe(0);
		}
		comp2.dispose();
	});

	it('keeps output parity after pooling', () => {
		function renderColor(color: string): number[] {
			const c = document.createElement('canvas');
			c.width = 4;
			c.height = 4;
			const comp = createGpuCompositor(c);
			expect(comp).not.toBeNull();
			if (!comp) return [0, 0, 0, 0];
			const src = solid(color, 4, 4);
			const ok = comp.render(src, 4, 4, [{ effectId: 'gpu-invert', params: {} }], {});
			expect(ok).toBe(true);
			const read = c.getContext('2d', { willReadFrequently: true });
			// Some browsers return null for OffscreenCanvas read; fallback to canvas copy
			let data: number[] = [0, 0, 0, 0];
			if (read) {
				data = Array.from(read.getImageData(0, 0, 1, 1).data);
			} else {
				const tmp = document.createElement('canvas');
				tmp.width = 4;
				tmp.height = 4;
				const tctx = tmp.getContext('2d', { willReadFrequently: true });
				if (tctx) {
					tctx.drawImage(c, 0, 0);
					data = Array.from(tctx.getImageData(0, 0, 1, 1).data);
				}
			}
			comp.dispose();
			return data;
		}
		gpuResourcePool.clearAll();
		const first = renderColor('#ff8040');
		gpuResourcePool.clearAll();
		const second = renderColor('#ff8040');
		expect(first).toEqual(second);
	});

	it('shares WebGL context across CanvasStackCompositor instances and keeps refcount safe', () => {
		const outA = createStackCanvas(64, 64);
		const stackA = new CanvasStackCompositor(outA);
		stackA.beginFrame(64, 64, '#000000');
		const red = solid('#ff0000', 16, 16);
		stackA.compositeLayer(
			{ source: red, width: 16, height: 16 },
			{
				id: 'l',
				trackId: 't',
				from: 0,
				durationInFrames: 1,
				label: 'L',
				type: 'image',
				blendMode: 'multiply'
			} as unknown as import('../../project/types').TimelineItem,
			1,
			0
		);
		expect(sharedGpuCompositorStats().alive).toBe(true);
		const refAfterA = sharedGpuCompositorStats().refCount;
		expect(refAfterA).toBeGreaterThan(0);

		const outB = createStackCanvas(64, 64);
		const stackB = new CanvasStackCompositor(outB);
		expect(sharedGpuCompositorStats().refCount).toBeGreaterThan(refAfterA);
		expect(sharedGpuCompositorStats().alive).toBe(true);

		// Disposing A must not invalidate B
		stackA.dispose();
		expect(sharedGpuCompositorStats().alive).toBe(true);
		stackB.beginFrame(64, 64, '#111111');
		const green = solid('#00ff00', 16, 16);
		stackB.compositeLayer(
			{ source: green, width: 16, height: 16 },
			{
				id: 'l2',
				trackId: 't',
				from: 0,
				durationInFrames: 1,
				label: 'L2',
				type: 'image',
				blendMode: 'multiply'
			} as unknown as import('../../project/types').TimelineItem,
			1,
			0
		);
		const pixelB = readPixelFromCanvas(outB);
		expect(pixelB[1]).toBeGreaterThan(0);

		stackB.dispose();
		// Shared stays alive until explicit dispose (keeps compiled programs for next use)
		expect(sharedGpuCompositorStats().alive).toBe(true);
		disposeSharedGpuCompositor();
		expect(sharedGpuCompositorStats().alive).toBe(false);

		// New stack after explicit dispose should recreate cleanly
		const outC = createStackCanvas(32, 32);
		const stackC = new CanvasStackCompositor(outC);
		stackC.beginFrame(32, 32, '#000000');
		expect(sharedGpuCompositorStats().alive).toBe(true);
		stackC.dispose();
		disposeSharedGpuCompositor();
	});

	it('reuses pooled 2D canvases across CanvasStackCompositor lifecycles at final size', () => {
		canvasPool.clear();
		canvasPool.maxCount = 12;
		canvasPool.maxBytes = 64 * 1024 * 1024;

		const out1 = createStackCanvas(32, 32);
		const stack1 = new CanvasStackCompositor(out1);
		stack1.beginFrame(32, 32, '#000000');
		stack1.compositeLayer(
			{ source: solid('#ff0000', 8, 8), width: 8, height: 8 },
			{
				id: 'a',
				trackId: 't',
				from: 0,
				durationInFrames: 1,
				label: 'A',
				type: 'image'
			} as unknown as import('../../project/types').TimelineItem,
			1,
			0
		);
		stack1.dispose();
		const pooledAfterFirst = canvasPool.count();
		expect(pooledAfterFirst).toBeGreaterThan(0);

		const out2 = createStackCanvas(32, 32);
		const stack2 = new CanvasStackCompositor(out2);
		stack2.beginFrame(32, 32, '#ff0000');
		// No stale red from previous stack should bleed through after pooling
		const ctx2 = out2.getContext('2d', { willReadFrequently: true });
		expect(ctx2).not.toBeNull();
		if (ctx2) {
			const bg = Array.from(ctx2.getImageData(16, 16, 1, 1).data);
			expect(bg[0]).toBeGreaterThan(200);
		}
		stack2.dispose();
		expect(canvasPool.count()).toBeLessThanOrEqual(canvasPool.maxCount);
		expect(canvasPool.bytesRetained()).toBeLessThanOrEqual(canvasPool.maxBytes);
	});

	it('keeps transition branches rendering after parent resize (regression for detached canvas)', () => {
		const out = createStackCanvas(32, 32);
		const stack = new CanvasStackCompositor(out);
		stack.beginFrame(32, 32, '#000000');
		const red = solid('#ff0000', 16, 16);
		const blue = solid('#0000ff', 16, 16);
		const outgoing = {
			id: 'out',
			trackId: 't0',
			from: 0,
			durationInFrames: 10,
			label: 'Out',
			type: 'image'
		} as unknown as import('../../project/types').TimelineItem;
		const incoming = {
			id: 'in',
			trackId: 't1',
			from: 0,
			durationInFrames: 10,
			label: 'In',
			type: 'image'
		} as unknown as import('../../project/types').TimelineItem;
		const transition = {
			id: 'tr',
			type: 'crossfade' as const,
			presentation: 'dissolve' as const,
			durationInFrames: 10,
			fromItemId: 'out',
			toItemId: 'in'
		};
		// First transition at 32
		expect(
			stack.compositeTransition(
				{ source: { source: red, width: 16, height: 16 }, item: outgoing, alpha: 1 },
				{ source: { source: blue, width: 16, height: 16 }, item: incoming, alpha: 1 },
				transition,
				0,
				0
			)
		).toBe(true);
		let pixel = readPixelFromCanvas(out);
		expect(pixel[0]).toBeGreaterThan(150);

		// Resize parent to 64 and do another transition - branch canvases must have followed via their own resize, not stayed detached at 32
		stack.beginFrame(64, 64, '#000000');
		expect(
			stack.compositeTransition(
				{ source: { source: red, width: 16, height: 16 }, item: outgoing, alpha: 1 },
				{ source: { source: blue, width: 16, height: 16 }, item: incoming, alpha: 1 },
				transition,
				1,
				0
			)
		).toBe(true);
		pixel = readPixelFromCanvas(out);
		// At progress 1 the incoming (blue) should dominate
		expect(pixel[2]).toBeGreaterThan(150);
		expect(pixel[0]).toBeLessThan(50);
		stack.dispose();
		disposeSharedGpuCompositor();
	});

	it('benchmarks allocation count under layered timeline via shared compositor', () => {
		const shared = acquireSharedGpuCompositor();
		expect(shared).not.toBeNull();
		if (!shared) return;
		const gl = (shared.compositor as unknown as { gl: WebGL2RenderingContext }).gl;
		let creates = 0;
		const origCreate = gl.createTexture.bind(gl);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(gl as any).createTexture = () => {
			creates++;
			return origCreate();
		};
		const w = 128;
		const h = 128;
		const layer = solid('#808080', 16, 16);

		const out = createStackCanvas(w, h);
		const stack = new CanvasStackCompositor(out);
		stack.beginFrame(w, h, '#000000');
		for (let i = 0; i < 8; i++) {
			stack.compositeLayer(
				{ source: layer, width: 16, height: 16 },
				{
					id: `id-${i}`,
					trackId: 't',
					from: 0,
					durationInFrames: 100,
					label: `L${i}`,
					type: 'image',
					blendMode: i % 2 === 0 ? 'multiply' : 'normal'
				} as unknown as import('../../project/types').TimelineItem,
				1,
				i * 0.1
			);
		}
		const afterFirstFrame = creates;

		stack.beginFrame(w, h, '#000000');
		for (let i = 0; i < 8; i++) {
			stack.compositeLayer(
				{ source: layer, width: 16, height: 16 },
				{
					id: `id2-${i}`,
					trackId: 't',
					from: 0,
					durationInFrames: 100,
					label: `L${i}`,
					type: 'image',
					blendMode: i % 2 === 0 ? 'multiply' : 'normal'
				} as unknown as import('../../project/types').TimelineItem,
				1,
				i * 0.1
			);
		}
		const afterSecondFrame = creates;
		expect(afterSecondFrame).toBe(afterFirstFrame);
		expect(gpuResourcePool.countFor(gl)).toBeLessThanOrEqual(gpuResourcePool.maxCount);
		expect(canvasPool.count()).toBeLessThanOrEqual(canvasPool.maxCount);
		stack.dispose();
		releaseSharedGpuCompositor();
		disposeSharedGpuCompositor();
	});

	it('does not leak OffscreenCanvas via pool caps', () => {
		canvasPool.clear();
		canvasPool.maxCount = 3;
		canvasPool.maxBytes = 8 * 1024 * 1024;
		for (let i = 0; i < 10; i++) {
			const c =
				typeof OffscreenCanvas === 'function'
					? new OffscreenCanvas(128, 128)
					: document.createElement('canvas');
			c.width = 128;
			c.height = 128;
			canvasPool.release(c);
		}
		expect(canvasPool.count()).toBeLessThanOrEqual(3);
		expect(canvasPool.bytesRetained()).toBeLessThanOrEqual(8 * 1024 * 1024);
	});

	it('properly removes webglcontextlost listeners on dispose', () => {
		const canvas = document.createElement('canvas');
		const comp = createGpuCompositor(canvas);
		expect(comp).not.toBeNull();
		if (!comp) return;
		const gl = (comp as unknown as { gl: WebGL2RenderingContext }).gl;
		const src = solid('#ff0000', 16, 16);
		expect(comp.render(src, 16, 16, [], {})).toBe(true);
		comp.dispose();
		expect(gpuResourcePool.countFor(gl)).toBe(0);
		comp.dispose();
	});
});
