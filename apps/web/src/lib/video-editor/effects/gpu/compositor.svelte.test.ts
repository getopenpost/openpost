import { describe, expect, it, vi } from 'vitest';
import { GpuCompositor, type GpuRenderEffect } from './compositor';
import { lut, encodeLutData } from './lut';
import type { GpuParamValues } from './types';

function solidLut(red: number, green: number, blue: number, size = 2): GpuParamValues {
	const data = new Uint8Array(size ** 3 * 4);
	for (let index = 0; index < data.length; index += 4) data.set([red, green, blue, 255], index);
	return { lutSize: size, lutData: encodeLutData(data), intensity: 1 };
}

function fixture() {
	const canvas = new OffscreenCanvas(1, 1);
	const compositor = GpuCompositor.create(canvas)!;
	const source = new ImageData(new Uint8ClampedArray([80, 120, 160, 255]), 1, 1);
	const read = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
	return {
		compositor,
		gl: canvas.getContext('webgl2')!,
		render(params: GpuParamValues) {
			expect(compositor.render(source, 1, 1, [{ effectId: 'gpu-lut', params }])).toBe(true);
			read.drawImage(canvas, 0, 0);
			return [...read.getImageData(0, 0, 1, 1).data];
		}
	};
}

describe('GPU effect texture reuse', () => {
	it('keeps distinct clip LUTs resident while rendering their current colors', () => {
		const { compositor, render } = fixture();
		if (lut.paperShader !== undefined) throw new Error('Expected a LUT program.');
		const build = vi.spyOn(lut.dataTexture!, 'build');
		const red = solidLut(255, 0, 0);
		const blue = solidLut(0, 0, 255);
		try {
			for (let frame = 0; frame < 3; frame++) {
				expect(render(red)).toEqual([255, 0, 0, 255]);
				expect(render(blue)).toEqual([0, 0, 255, 255]);
			}
			expect(build).toHaveBeenCalledTimes(2);
		} finally {
			build.mockRestore();
			compositor.dispose();
		}
	});

	it('revalidates the LUT dimensions even when the encoded bytes are unchanged', () => {
		const { compositor, render } = fixture();
		const red = solidLut(255, 0, 0);
		try {
			expect(render(red)).toEqual([255, 0, 0, 255]);
			// A 2-cube cannot fill a 3-cube. Invalid data must use the identity fallback.
			expect(render({ ...red, lutSize: 3 })).toEqual([80, 120, 160, 255]);
			expect(render(red)).toEqual([255, 0, 0, 255]);
		} finally {
			compositor.dispose();
		}
	});

	it('releases large LUTs evicted by the retained-byte budget', () => {
		const { compositor, render, gl } = fixture();
		if (lut.paperShader !== undefined) throw new Error('Expected a LUT program.');
		const build = vi.spyOn(lut.dataTexture!, 'build');
		// Each 129-cube consumes over 8 MiB. Two exceed the 16 MiB retention budget.
		const red = solidLut(255, 0, 0, 129);
		const blue = solidLut(0, 0, 255, 129);
		try {
			expect(render(red)).toEqual([255, 0, 0, 255]);
			const redTexture = gl.getParameter(gl.TEXTURE_BINDING_3D);
			expect(render(blue)).toEqual([0, 0, 255, 255]);
			expect(gl.isTexture(redTexture)).toBe(false);
			const blueTexture = gl.getParameter(gl.TEXTURE_BINDING_3D);
			expect(render(red)).toEqual([255, 0, 0, 255]);
			expect(gl.isTexture(blueTexture)).toBe(false);
			expect(build).toHaveBeenCalledTimes(3);
		} finally {
			build.mockRestore();
			compositor.dispose();
		}
	});

	it('evicts old animated variants and can recreate them without stale pixels', () => {
		const { compositor, render } = fixture();
		if (lut.paperShader !== undefined) throw new Error('Expected a LUT program.');
		const build = vi.spyOn(lut.dataTexture!, 'build');
		try {
			for (let value = 0; value < 40; value++) {
				expect(render(solidLut(value, 0, 0))).toEqual([value, 0, 0, 255]);
			}
			build.mockClear();
			expect(render(solidLut(0, 0, 0))).toEqual([0, 0, 0, 255]);
			expect(build).toHaveBeenCalledTimes(1);
		} finally {
			build.mockRestore();
			compositor.dispose();
		}
	});
});

it('updates reused color uniforms after changing the stack length and parameter layout', () => {
	const canvas = new OffscreenCanvas(1, 1);
	const compositor = GpuCompositor.create(canvas)!;
	const source = new ImageData(new Uint8ClampedArray([64, 128, 192, 255]), 1, 1);
	const read = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
	const cases: { effects: GpuRenderEffect[]; expected: number[] }[] = [
		{
			effects: [
				{ effectId: 'gpu-levels', params: { outputWhite: 0.5 } },
				{ effectId: 'gpu-brightness', params: { amount: 0.25 } }
			],
			expected: [96, 128, 160, 255]
		},
		{
			effects: Array.from({ length: 13 }, () => ({ effectId: 'gpu-invert', params: {} })),
			expected: [191, 127, 63, 255]
		},
		{
			effects: [
				{ effectId: 'gpu-brightness', params: { amount: 0 } },
				{ effectId: 'gpu-contrast', params: { amount: 1 } }
			],
			expected: [64, 128, 192, 255]
		}
	];
	try {
		for (const { effects, expected } of cases) {
			expect(compositor.render(source, 1, 1, effects)).toBe(true);
			read.drawImage(canvas, 0, 0);
			expect([...read.getImageData(0, 0, 1, 1).data]).toEqual(expected);
		}
	} finally {
		compositor.dispose();
	}
});
