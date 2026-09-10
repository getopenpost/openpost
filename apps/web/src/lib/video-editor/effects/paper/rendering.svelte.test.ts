import { describe, expect, it } from 'vitest';
import { GpuCompositor } from '../gpu/compositor';
import { defaultGpuParams } from '../gpu/types';
import { PAPER_GPU_EFFECTS } from './gpu-effects';
import { ShaderBackgroundRenderer } from '../../backgrounds/shader-renderer';
import { SHADER_PRESETS } from '../../backgrounds/shaders';
import { getPaperShader } from './catalog';

function pixels(source: OffscreenCanvas): Uint8ClampedArray {
	const canvas = new OffscreenCanvas(source.width, source.height);
	const context = canvas.getContext('2d')!;
	context.drawImage(source, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function sourceFrame(alternate = false): OffscreenCanvas {
	const canvas = new OffscreenCanvas(256, 144);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#e82947';
	ctx.fillRect(35, 28, alternate ? 110 : 45, 88);
	ctx.fillStyle = '#247ae8';
	ctx.fillRect(140, 40, 70, alternate ? 36 : 72);
	return canvas;
}

// Acceptance inventory from https://shaders.paper.design, reviewed 2026-09-10.
const backgroundIds = [
	'color-panels',
	'dithering',
	'dot-grid',
	'dot-orbit',
	'god-rays',
	'grain-gradient',
	'mesh-gradient',
	'metaballs',
	'neuro-noise',
	'perlin-noise',
	'pulsing-border',
	'simplex-noise',
	'smoke-ring',
	'spiral',
	'static-mesh-gradient',
	'static-radial-gradient',
	'swirl',
	'voronoi',
	'warp',
	'waves'
];
const effectIds = [
	'paper-texture',
	'fluted-glass',
	'water',
	'image-dithering',
	'halftone-dots',
	'halftone-cmyk',
	'lens-distortion',
	'heatmap',
	'liquid-metal',
	'gem-smoke'
];

describe('complete Paper catalogue', () => {
	for (const id of backgroundIds) {
		it(`${id} produces pixels, preserves time, and supports frozen frames`, () => {
			const preset = SHADER_PRESETS.find((preset) => preset.background.shader === `paper:${id}`);
			expect(preset).toBeDefined();
			if (!preset) throw new Error(`Missing background: ${id}`);
			const renderer = new ShaderBackgroundRenderer();
			try {
				const first = pixels(renderer.render(preset.background, 256, 144, 0));
				const colors = new Set<string>();
				for (let i = 0; i < first.length; i += 4)
					colors.add(`${first[i]},${first[i + 1]},${first[i + 2]}`);
				expect(colors.size).toBeGreaterThan(1);
				const later = pixels(renderer.render(preset.background, 256, 144, 2));
				if (
					getPaperShader(preset.background.shader.slice(6))!.animated &&
					preset.background.speed > 0
				)
					expect(later).not.toEqual(first);
				else expect(later).toEqual(first);
				const sought = pixels(renderer.render(preset.background, 256, 144, 0));
				expect(
					sought.reduce((count, value, index) => count + Number(value !== first[index]), 0)
				).toBe(0);
				const frozen = { ...preset.background, speed: 0, phase: 2 };
				const stillFirst = pixels(renderer.render(frozen, 256, 144, 1));
				const stillLater = pixels(renderer.render(frozen, 256, 144, 9));
				expect(
					stillFirst.reduce((count, value, index) => count + Number(value !== stillLater[index]), 0)
				).toBe(0);
			} finally {
				renderer.dispose();
			}
		});
	}
	for (const id of effectIds) {
		it(`${id} processes the current clip and seeks identically in a fresh compositor`, () => {
			const effect = PAPER_GPU_EFFECTS.find((effect) => effect.id === `gpu-paper-${id}`);
			expect(effect).toBeDefined();
			if (!effect) throw new Error(`Missing image shader: ${id}`);
			const canvas = new OffscreenCanvas(256, 144);
			const compositor = GpuCompositor.create(canvas)!;
			const params = defaultGpuParams(effect.schema);
			const effects = [{ effectId: effect.id, params }];
			try {
				expect(
					compositor.render(sourceFrame(), 256, 144, effects, { time: 0 }),
					compositor.failureReason()
				).toBe(true);
				const first = pixels(canvas);
				expect(first).not.toEqual(pixels(sourceFrame()));
				expect(
					compositor.render(sourceFrame(true), 256, 144, effects, { time: 0 }),
					compositor.failureReason()
				).toBe(true);
				expect(pixels(canvas)).not.toEqual(first);
				expect(
					compositor.render(sourceFrame(), 256, 144, effects, { time: 2 }),
					compositor.failureReason()
				).toBe(true);
				const later = pixels(canvas);
				if (Number(params.speed) > 0) expect(later).not.toEqual(first);
				expect(compositor.render(sourceFrame(), 256, 144, effects, { time: 0 })).toBe(true);
				expect(pixels(canvas)).toEqual(first);
				const exportCanvas = new OffscreenCanvas(256, 144);
				const exporter = GpuCompositor.create(exportCanvas)!;
				try {
					expect(
						exporter.render(sourceFrame(), 256, 144, effects, { time: 2 }),
						exporter.failureReason()
					).toBe(true);
					expect(pixels(exportCanvas)).toEqual(later);
				} finally {
					exporter.dispose();
				}
			} finally {
				compositor.dispose();
			}
		});
	}
});

it('Heatmap retains the size and position of logos at either image edge', () => {
	const canvas = new OffscreenCanvas(256, 256);
	const compositor = GpuCompositor.create(canvas)!;
	const effect = PAPER_GPU_EFFECTS.find((effect) => effect.id === 'gpu-paper-heatmap')!;
	const params = {
		...defaultGpuParams(effect.schema),
		scale: 1,
		colorCount: 1,
		color1: '#ffffff',
		colorBack: '#00000000',
		outerGlow: 0,
		innerGlow: 0,
		contour: 1
	};
	try {
		for (const x of [0, 112, 224]) {
			const source = new OffscreenCanvas(256, 256);
			const context = source.getContext('2d')!;
			context.fillStyle = '#ffffff';
			context.fillRect(x, 100, 32, 48);
			expect(
				compositor.render(source, 256, 256, [{ effectId: effect.id, params }]),
				compositor.failureReason()
			).toBe(true);
			const output = pixels(canvas);
			const occupied: number[] = [];
			for (let column = 0; column < 256; column++) {
				for (let row = 0; row < 256; row++) {
					if (output[(row * 256 + column) * 4 + 3]! > 10) {
						occupied.push(column);
						break;
					}
				}
			}
			expect(occupied.length).toBeGreaterThan(20);
			expect(Math.min(...occupied)).toBeGreaterThanOrEqual(x - 2);
			expect(Math.max(...occupied)).toBeLessThanOrEqual(x + 33);
		}
	} finally {
		compositor.dispose();
	}
});
