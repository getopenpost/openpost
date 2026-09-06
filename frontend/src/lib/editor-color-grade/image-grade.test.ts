import { describe, expect, it } from 'vitest';
import { applyImageGradePixels, imageAdjustmentsToGradeEffects } from './image-grade';

const neutralGrade = {
	brightness: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	tint: 0,
	vibrance: 0,
	hue: 0,
	exposure: 0,
	highlights: 0,
	shadows: 0
};

describe('versioned still-image color grade', () => {
	it('maps image controls to the same ordered GPU effects used by video', () => {
		expect(
			imageAdjustmentsToGradeEffects({
				brightness: 0.1,
				contrast: 0.2,
				saturation: -0.25,
				temperature: 0.3,
				tint: -0.1,
				vibrance: 0.4,
				hue: 0.5,
				exposure: 0.2,
				highlights: -0.2,
				shadows: 0.15,
				blur: 0.6
			})
		).toEqual([
			{ effectId: 'gpu-brightness', params: { amount: 0.1 } },
			{
				effectId: 'gpu-exposure',
				params: { exposure: 0.6, offset: 0, gamma: 1 }
			},
			{ effectId: 'gpu-contrast', params: { amount: 1.2 } },
			{ effectId: 'gpu-saturation', params: { amount: 0.75 } },
			{ effectId: 'gpu-vibrance', params: { amount: 0.4 } },
			{ effectId: 'gpu-hue-shift', params: { shift: 0.5, span: 1, flow: 0 } },
			{ effectId: 'gpu-temperature', params: { temperature: 0.3, tint: -0.1 } },
			{
				effectId: 'gpu-color-wheels',
				params: {
					lift: 0,
					gain: 1,
					gamma: 1,
					offset: 0,
					shadows: 15,
					highlights: -20
				}
			}
		]);
	});

	it('omits neutral color operations and the Fabric-owned blur control', () => {
		expect(imageAdjustmentsToGradeEffects(neutralGrade)).toEqual([]);
	});

	it('keeps alpha unchanged in the deterministic CPU fallback', () => {
		const pixels = new Uint8ClampedArray([10, 20, 30, 7, 240, 230, 220, 199]);
		applyImageGradePixels(pixels, { ...neutralGrade, brightness: 0.1 });
		expect([...pixels]).toEqual([36, 46, 56, 7, 255, 255, 246, 199]);
	});

	it('matches the GPU shadows and highlights masks in the CPU fallback', () => {
		const pixels = new Uint8ClampedArray([0, 0, 0, 17, 255, 255, 255, 23]);
		applyImageGradePixels(pixels, { ...neutralGrade, shadows: 0.1, highlights: -0.2 });
		expect([...pixels]).toEqual([26, 26, 26, 17, 204, 204, 204, 23]);
	});
});
