import { describe, expect, it } from 'vitest';
import { ALL_BLEND_MODES, type BlendMode } from '../effects/gpu/blend-modes';
import { blendImageData } from '../effects/gpu/cpu-blend';
import { createGpuCompositor } from '../effects/gpu/compositor';
import type { TimelineItem } from '../project/types';
import { CanvasStackCompositor } from './canvas-stack-compositor';
import { doesShapeMaskAffectTrack } from '../shapes/masks';
import {
	computeCornerPinHomography,
	projectCornerPinPoint,
	resolveCornerPinForSize
} from '../preview/corner-pin';

function solid(color: string, width = 4, height = 4): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	context.fillStyle = color;
	context.fillRect(0, 0, width, height);
	return canvas;
}

function splitSource(width = 8, height = 4): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, width / 2, height);
	context.fillStyle = '#00ff00';
	context.fillRect(width / 2, 0, width / 2, height);
	return canvas;
}

function layer(blendMode: BlendMode, opacity = 1): TimelineItem {
	return {
		id: 'layer',
		trackId: 'top',
		from: 0,
		durationInFrames: 30,
		label: 'Layer',
		type: 'image',
		blendMode,
		transform: { width: 4, height: 4, opacity }
	};
}

function mask(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'mask',
		trackId: 'mask-track',
		from: 0,
		durationInFrames: 30,
		label: 'Mask',
		type: 'shape',
		shapeType: 'rectangle',
		isMask: true,
		maskType: 'clip',
		maskOpacity: 100,
		transform: { width: 4, height: 8 },
		...overrides
	};
}

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): number[] {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return Array.from(context.getImageData(x, y, 1, 1).data);
}

function pixel(canvas: HTMLCanvasElement): number[] {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return Array.from(context.getImageData(2, 2, 1, 1).data);
}

function webglPixel(canvas: HTMLCanvasElement): number[] {
	const context = canvas.getContext('webgl2');
	if (!context) throw new Error('WebGL2 unavailable');
	const result = new Uint8Array(4);
	context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, result);
	return Array.from(result);
}

function displayedPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
	const copy = document.createElement('canvas');
	copy.width = canvas.width;
	copy.height = canvas.height;
	const context = copy.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, copy.width, copy.height).data;
}

describe('CanvasStackCompositor', () => {
	it('keeps the uncropped source in place inside the clip bounds', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(8, 4, '#0000ff');
		const item = {
			...layer('normal'),
			transform: { width: 8, height: 4 },
			crop: { left: 0.5, right: 0, top: 0, bottom: 0 }
		};

		stack.compositeLayer({ source: splitSource(), width: 8, height: 4 }, item, 1, 0);

		expect(pixelAt(output, 1, 2)).toEqual([0, 0, 255, 255]);
		expect(pixelAt(output, 6, 2)).toEqual([0, 255, 0, 255]);
		stack.dispose();
	});

	it('renders signed crop softness as a feather instead of a hard edge', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(16, 16, '#000000');
		const item = {
			...layer('normal'),
			transform: { width: 16, height: 16 },
			crop: { left: 0.25, right: 0, top: 0, bottom: 0, softness: -0.125 }
		};

		stack.compositeLayer({ source: solid('#ffffff', 16, 16), width: 16, height: 16 }, item, 1, 0);

		expect(pixelAt(output, 3, 8)).toEqual([0, 0, 0, 255]);
		const [edge] = pixelAt(output, 5, 8);
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(255);
		expect(pixelAt(output, 8, 8)).toEqual([255, 255, 255, 255]);
		stack.dispose();
	});

	it('preserves corner offsets across item resizing and maps exact quad corners', () => {
		const pin = resolveCornerPinForSize(
			{
				topLeft: [10, 5],
				topRight: [-10, 0],
				bottomRight: [0, -5],
				bottomLeft: [5, 0],
				referenceWidth: 100,
				referenceHeight: 50
			},
			200,
			100
		);
		expect(pin).toEqual({
			topLeft: [20, 10],
			topRight: [-20, 0],
			bottomRight: [0, -10],
			bottomLeft: [10, 0]
		});
		if (!pin) return;
		const homography = computeCornerPinHomography(200, 100, pin);
		expect(projectCornerPinPoint(homography, 0, 0)).toEqual([20, 10]);
		const bottomRight = projectCornerPinPoint(homography, 200, 100);
		expect(bottomRight[0]).toBeCloseTo(200);
		expect(bottomRight[1]).toBeCloseTo(90);
	});

	it('warps a layer before it reaches the shared preview and export stack', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(8, 8, '#0000ff');
		const item: TimelineItem = {
			...layer('normal'),
			transform: { width: 8, height: 8 },
			cornerPin: {
				topLeft: [2, 0],
				topRight: [0, 0],
				bottomRight: [0, 0],
				bottomLeft: [2, 0],
				referenceWidth: 8,
				referenceHeight: 8
			}
		};

		stack.compositeLayer({ source: solid('#ff0000', 8, 8), width: 8, height: 8 }, item, 1, 0);

		expect(pixelAt(output, 0, 4)).toEqual([0, 0, 255, 255]);
		expect(pixelAt(output, 4, 4)).toEqual([255, 0, 0, 255]);
		stack.dispose();
	});

	it('scopes masks to tracks below their timeline position', () => {
		expect(doesShapeMaskAffectTrack(0, 1)).toBe(true);
		expect(doesShapeMaskAffectTrack(0, 3)).toBe(true);
		expect(doesShapeMaskAffectTrack(1, 1)).toBe(false);
		expect(doesShapeMaskAffectTrack(2, 0)).toBe(false);
	});

	it('clips one layer without clipping the project background', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(8, 8, '#0000ff');
		const item = { ...layer('normal'), transform: { width: 8, height: 8 } };

		stack.compositeLayer({ source: solid('#ff0000', 8, 8), width: 8, height: 8 }, item, 1, 0, [
			mask()
		]);

		expect(pixelAt(output, 4, 4)).toEqual([255, 0, 0, 255]);
		expect(pixelAt(output, 0, 4)).toEqual([0, 0, 255, 255]);
		stack.dispose();
	});

	it('uses the same projective warp for shape masks', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(8, 8, '#0000ff');
		const item = { ...layer('normal'), transform: { width: 8, height: 8 } };
		const pinnedMask = mask({
			transform: { width: 8, height: 8 },
			cornerPin: {
				topLeft: [2, 0],
				topRight: [0, 0],
				bottomRight: [0, 0],
				bottomLeft: [2, 0],
				referenceWidth: 8,
				referenceHeight: 8
			}
		});

		stack.compositeLayer({ source: solid('#ff0000', 8, 8), width: 8, height: 8 }, item, 1, 0, [
			pinnedMask
		]);

		expect(pixelAt(output, 0, 4)).toEqual([0, 0, 255, 255]);
		expect(pixelAt(output, 4, 4)).toEqual([255, 0, 0, 255]);
		stack.dispose();
	});

	it('supports inverted and partial-opacity alpha masks', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		const item = { ...layer('normal'), transform: { width: 8, height: 8 } };
		stack.beginFrame(8, 8, '#000000');
		stack.compositeLayer({ source: solid('#ff0000', 8, 8), width: 8, height: 8 }, item, 1, 0, [
			mask({ maskType: 'alpha', maskOpacity: 50 })
		]);
		const [insideRed] = pixelAt(output, 4, 4);
		expect(insideRed).toBeGreaterThanOrEqual(126);
		expect(insideRed).toBeLessThanOrEqual(129);
		expect(pixelAt(output, 0, 4)).toEqual([0, 0, 0, 255]);

		stack.beginFrame(8, 8, '#000000');
		stack.compositeLayer({ source: solid('#ff0000', 8, 8), width: 8, height: 8 }, item, 1, 0, [
			mask({ maskInvert: true })
		]);
		expect(pixelAt(output, 4, 4)).toEqual([0, 0, 0, 255]);
		expect(pixelAt(output, 0, 4)).toEqual([255, 0, 0, 255]);
		stack.dispose();
	});

	it('intersects multiple masks and feathers alpha edges', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		const item = { ...layer('normal'), transform: { width: 16, height: 16 } };
		stack.beginFrame(16, 16, '#000000');
		stack.compositeLayer({ source: solid('#ffffff', 16, 16), width: 16, height: 16 }, item, 1, 0, [
			mask({ transform: { width: 8, height: 16 } }),
			mask({ id: 'mask-2', transform: { width: 16, height: 8 } })
		]);
		expect(pixelAt(output, 8, 8)).toEqual([255, 255, 255, 255]);
		expect(pixelAt(output, 8, 1)).toEqual([0, 0, 0, 255]);
		expect(pixelAt(output, 1, 8)).toEqual([0, 0, 0, 255]);

		stack.beginFrame(16, 16, '#000000');
		stack.compositeLayer({ source: solid('#ffffff', 16, 16), width: 16, height: 16 }, item, 1, 0, [
			mask({ maskType: 'alpha', maskFeather: 2, transform: { width: 8, height: 16 } })
		]);
		const [edge] = pixelAt(output, 4, 8);
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(255);
		stack.dispose();
	});

	it.each([
		{ mode: 'multiply' as const, expected: [64, 64, 64, 255] },
		{ mode: 'screen' as const, expected: [192, 192, 192, 255] }
	])('blends $mode against the finished frame below', ({ mode, expected }) => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#808080');
		const source = solid('#808080');

		stack.compositeLayer({ source, width: 4, height: 4 }, layer(mode), 1, 0);

		expect(pixel(output).map((value) => Math.round(value))).toEqual(expected);
		expect(stack.failureReason()).toBeNull();
		stack.dispose();
	});

	it('includes transformed layer opacity in the GPU blend', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#808080');
		const source = solid('#000000');

		stack.compositeLayer({ source, width: 4, height: 4 }, layer('multiply', 0.5), 0.5, 0);

		const [red, green, blue, alpha] = pixel(output);
		expect(red).toBeGreaterThanOrEqual(62);
		expect(red).toBeLessThanOrEqual(66);
		expect(green).toBe(red);
		expect(blue).toBe(red);
		expect(alpha).toBe(255);
		stack.dispose();
	});

	it('applies render-time scale without changing source layout bounds', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(8, 8, '#00000000');
		const source = solid('#ff0000');
		const item = layer('normal');
		item.transform = { ...item.transform, scaleX: 2, scaleY: 2 };

		stack.compositeLayer({ source, width: 4, height: 4 }, item, 1, 0);

		expect(pixelAt(output, 1, 1)).toEqual([255, 0, 0, 255]);
		expect(item.transform.width).toBe(4);
		expect(item.transform.height).toBe(4);
		stack.dispose();
	});

	it('runs clip GPU effects before blending the transformed layer', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#808080');
		const source = solid('#ff0000');
		const item = layer('multiply');
		item.effects = [
			{ id: 'invert', type: 'gpu', effectId: 'gpu-invert', enabled: true, params: {} }
		];

		stack.compositeLayer({ source, width: 4, height: 4 }, item, 1, 0);

		const [red, green, blue, alpha] = pixel(output);
		expect(red).toBeLessThanOrEqual(2);
		expect(green).toBeGreaterThanOrEqual(126);
		expect(blue).toBeGreaterThanOrEqual(126);
		expect(alpha).toBe(255);
		stack.dispose();
	});

	it('reports and rejects a frame when an enabled GPU effect cannot render', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#000000');
		const source = solid('#ff0000');
		const item = layer('normal');
		item.effects = [
			{
				id: 'missing-renderer',
				type: 'gpu',
				effectId: 'gpu-missing-renderer',
				enabled: true,
				params: {}
			}
		];

		stack.compositeLayer({ source, width: 4, height: 4 }, item, 1, 0);

		expect(stack.exactRenderFailureReason()).toContain('gpu-missing-renderer');
		expect(() => stack.assertExactRender()).toThrowError(
			'Video frame could not render exactly: GPU effect renderer unavailable: gpu-missing-renderer'
		);
		stack.dispose();
	});

	it.each(ALL_BLEND_MODES)('keeps the exact CPU fallback aligned with GPU %s', (mode) => {
		const base = solid('rgb(80 140 200)', 1, 1);
		const layerCanvas = solid('rgb(220 60 130 / 60%)', 1, 1);
		const baseContext = base.getContext('2d', { willReadFrequently: true });
		const layerContext = layerCanvas.getContext('2d', { willReadFrequently: true });
		expect(baseContext).not.toBeNull();
		expect(layerContext).not.toBeNull();
		if (!baseContext || !layerContext) return;
		const cpu = blendImageData(
			baseContext.getImageData(0, 0, 1, 1),
			layerContext.getImageData(0, 0, 1, 1),
			mode,
			0.6
		);

		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		expect(
			compositor.render(layerCanvas, 1, 1, [], {
				backdrop: base,
				blendMode: mode,
				dissolveAlpha: 0.6
			}),
			compositor.failureReason() ?? undefined
		).toBe(true);
		const gpu = webglPixel(output);
		for (let channel = 0; channel < 4; channel++) {
			expect(Math.abs((cpu.data[channel] ?? 0) - (gpu[channel] ?? 0))).toBeLessThanOrEqual(2);
		}
		compositor.dispose();
	});

	it('keeps the full dissolve pattern aligned between CPU and GPU', () => {
		const base = solid('rgb(80 140 200)');
		const layerCanvas = solid('rgb(220 60 130 / 60%)');
		const baseContext = base.getContext('2d', { willReadFrequently: true });
		const layerContext = layerCanvas.getContext('2d', { willReadFrequently: true });
		expect(baseContext).not.toBeNull();
		expect(layerContext).not.toBeNull();
		if (!baseContext || !layerContext) return;
		const cpu = blendImageData(
			baseContext.getImageData(0, 0, 4, 4),
			layerContext.getImageData(0, 0, 4, 4),
			'dissolve',
			0.6
		);

		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		expect(
			compositor.render(layerCanvas, 4, 4, [], {
				backdrop: base,
				blendMode: 'dissolve',
				dissolveAlpha: 0.6
			}),
			compositor.failureReason() ?? undefined
		).toBe(true);
		const gpu = displayedPixels(output);
		const mask = (pixels: Uint8ClampedArray) =>
			Array.from({ length: 16 }, (_, index) => ((pixels[index * 4] ?? 0) > 100 ? '1' : '0')).join(
				''
			);
		expect(mask(gpu)).toBe(mask(cpu.data));
		for (let channel = 0; channel < cpu.data.length; channel++) {
			expect(Math.abs((cpu.data[channel] ?? 0) - (gpu[channel] ?? 0))).toBeLessThanOrEqual(2);
		}
		compositor.dispose();
	});

	it('renders exact transition endpoints from two complete scene branches', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		const outgoing = layer('normal');
		const incoming = { ...layer('normal'), id: 'incoming' };
		const transition = {
			id: 'transition',
			type: 'crossfade' as const,
			presentation: 'dissolve',
			durationInFrames: 10,
			fromItemId: outgoing.id,
			toItemId: incoming.id
		};

		stack.beginFrame(4, 4, '#202020');
		expect(
			stack.compositeTransition(
				{ source: { source: solid('#ff0000'), width: 4, height: 4 }, item: outgoing, alpha: 1 },
				{ source: { source: solid('#0000ff'), width: 4, height: 4 }, item: incoming, alpha: 1 },
				transition,
				0,
				0
			)
		).toBe(true);
		expect(pixel(output)).toEqual([255, 0, 0, 255]);

		stack.beginFrame(4, 4, '#202020');
		stack.compositeTransition(
			{ source: { source: solid('#ff0000'), width: 4, height: 4 }, item: outgoing, alpha: 1 },
			{ source: { source: solid('#0000ff'), width: 4, height: 4 }, item: incoming, alpha: 1 },
			transition,
			1,
			0
		);
		expect(pixel(output)).toEqual([0, 0, 255, 255]);
		stack.dispose();
	});

	it('applies each transition participant mask before blending scene branches', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		const outgoing = { ...layer('normal'), transform: { width: 8, height: 8 } };
		const incoming = { ...outgoing, id: 'incoming' };
		stack.beginFrame(8, 8, '#0000ff');
		stack.compositeTransition(
			{
				source: { source: solid('#ff0000', 8, 8), width: 8, height: 8 },
				item: outgoing,
				alpha: 1,
				masks: [mask()]
			},
			{
				source: { source: solid('#00ff00', 8, 8), width: 8, height: 8 },
				item: incoming,
				alpha: 1,
				masks: [mask()]
			},
			{
				id: 'transition',
				type: 'crossfade',
				presentation: 'dissolve',
				durationInFrames: 10,
				fromItemId: outgoing.id,
				toItemId: incoming.id
			},
			0,
			0
		);

		expect(pixelAt(output, 4, 4)).toEqual([255, 0, 0, 255]);
		expect(pixelAt(output, 0, 4)).toEqual([0, 0, 255, 255]);
		stack.dispose();
	});

	it('keeps painting higher tracks after replacing the transition scene', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		const outgoing = layer('normal');
		const incoming = { ...layer('normal'), id: 'incoming' };
		stack.beginFrame(4, 4, '#000000');
		stack.compositeTransition(
			{ source: { source: solid('#ff0000'), width: 4, height: 4 }, item: outgoing, alpha: 1 },
			{ source: { source: solid('#0000ff'), width: 4, height: 4 }, item: incoming, alpha: 1 },
			{
				id: 'transition',
				type: 'crossfade',
				presentation: 'dissolve',
				durationInFrames: 10,
				fromItemId: outgoing.id,
				toItemId: incoming.id
			},
			0.5,
			0
		);
		const overlay = { ...layer('normal', 0.5), id: 'overlay' };
		stack.compositeLayer({ source: solid('#ffffff'), width: 4, height: 4 }, overlay, 0.5, 0);

		const [red, green, blue, alpha] = pixel(output);
		expect(red).toBeGreaterThanOrEqual(190);
		expect(green).toBeGreaterThanOrEqual(126);
		expect(blue).toBeGreaterThanOrEqual(190);
		expect(alpha).toBe(255);
		stack.dispose();
	});
});
