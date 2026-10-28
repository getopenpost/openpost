import { describe, expect, it } from 'vitest';
import { applyImageGradePixels, editorColorGradeAdjustmentsToEffects } from './image-grade';

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
		const adjustments = {
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
		};
		expect(editorColorGradeAdjustmentsToEffects(adjustments)).toEqual([
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
		expect(editorColorGradeAdjustmentsToEffects(neutralGrade)).toEqual([]);
		// Fabric owns blur for still images, so a non-zero blur must not reach
		// the shared color pipeline.
		const imageAdjustments = { ...neutralGrade, blur: 0.6 };
		expect(editorColorGradeAdjustmentsToEffects(imageAdjustments)).toEqual([]);
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

	it('clips and rounds between consecutive tone adjustments', () => {
		const pixels = new Uint8ClampedArray([240, 5, 128, 7]);
		applyImageGradePixels(pixels, { ...neutralGrade, brightness: 0.2, contrast: -0.5 });
		// Brightness first produces [255, 56, 179]. Contrast acts on those bytes,
		// including the clipped red channel, rather than the unbounded values.
		expect([...pixels]).toEqual([191, 92, 153, 7]);
	});

	it('preserves effect order across tone and channel-mixing adjustments', () => {
		const pixels = new Uint8ClampedArray([240, 5, 128, 7]);
		applyImageGradePixels(pixels, {
			...neutralGrade,
			brightness: 0.2,
			saturation: -1,
			temperature: 0.2,
			tint: 0.4
		});
		// The brightened channels have BT.601 luma 129.523, rounded to 130.
		// Temperature and tint then change red by +10.2 and green by -10.2.
		expect([...pixels]).toEqual([140, 120, 130, 7]);
	});
});

it('grades tonal wheels and RGB curves without changing alpha', () => {
	const wheels = {
		shadowsHue: 0,
		shadowsAmount: 0,
		midtonesHue: 0,
		midtonesAmount: 0,
		highlightsHue: 0,
		highlightsAmount: 0,
		offsetHue: 0,
		offsetAmount: 1,
		lift: 0,
		gamma: 1,
		gain: 1,
		offset: 0
	};
	const pixels = new Uint8ClampedArray([128, 128, 128, 77]);
	applyImageGradePixels(pixels, { ...neutralGrade, ...{ wheels } });
	expect([...pixels]).toEqual([128, 0, 0, 77]);
	const curved = new Uint8ClampedArray([128, 64, 32, 77]);
	applyImageGradePixels(curved, {
		...neutralGrade,
		...{ curves: { masterPoints: '[[0,0],[1,0.5]]' } }
	});
	expect([...curved]).toEqual([64, 32, 16, 77]);
});
