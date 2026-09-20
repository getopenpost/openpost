import { describe, expect, it } from 'vitest';
import {
	gradientColorAt,
	gradientRatioAtPoint,
	normalizedGradientStops,
	paintImageEditorCanvasGradient,
	retargetImageEditorGradient
} from './gradient';
import type { ImageEditorGradientValue } from './types';

function gradient(type: ImageEditorGradientValue['type']): ImageEditorGradientValue {
	return {
		type,
		start: { x: 0, y: 0 },
		end: { x: 100, y: 0 },
		reverse: false,
		stops: [
			{ offset: 0, color: '#000000' },
			{ offset: 1, color: '#ffffff' }
		]
	};
}

describe('OpenPost Image Editor gradients', () => {
	it('normalizes and reverses ordered color stops', () => {
		expect(
			normalizedGradientStops(
				[
					{ offset: 1, color: '#ffffff' },
					{ offset: 0, color: '#000000' }
				],
				true
			)
		).toEqual([
			{ offset: 0, color: '#ffffff' },
			{ offset: 1, color: '#000000' }
		]);
	});

	it('computes linear, reflected, radial, angle, and diamond positions', () => {
		expect(gradientRatioAtPoint(gradient('linear'), { x: 25, y: 0 })).toBeCloseTo(0.25);
		expect(gradientRatioAtPoint(gradient('reflected'), { x: -25, y: 0 })).toBeCloseTo(0.25);
		expect(gradientRatioAtPoint(gradient('radial'), { x: 0, y: 50 })).toBeCloseTo(0.5);
		expect(gradientRatioAtPoint(gradient('angle'), { x: 0, y: 10 })).toBeCloseTo(0.25);
		expect(gradientRatioAtPoint(gradient('diamond'), { x: 25, y: 25 })).toBeCloseTo(0.5);
	});

	it('interpolates gradient colors with alpha preserved', () => {
		expect(gradientColorAt(gradient('linear'), { x: 50, y: 0 })).toBe('#808080ff');
	});

	it.each(['radial', 'angle', 'reflected', 'diamond'] as const)(
		'centers %s geometry when changing from a linear gradient',
		(type) => {
			const result = retargetImageEditorGradient(gradient('linear'), type, 100, 80);

			expect(result.start).toEqual({ x: 50, y: 40 });
			expect(result.end).toEqual({ x: 100, y: 40 });
		}
	);

	it('expands centered geometry back across the page for a linear gradient', () => {
		const result = retargetImageEditorGradient(
			{
				...gradient('reflected'),
				start: { x: 50, y: 40 },
				end: { x: 100, y: 40 }
			},
			'linear',
			100,
			80
		);

		expect(result.start).toEqual({ x: 0, y: 40 });
		expect(result.end).toEqual({ x: 100, y: 40 });
	});

	it('paints diamond gradients from the center instead of falling back to linear', () => {
		const pixels = new Uint8ClampedArray(3 * 3 * 4);
		const context = {
			createImageData: () => ({ data: pixels, width: 3, height: 3 }),
			putImageData: () => undefined
		};
		const value = {
			...gradient('diamond'),
			start: { x: 1.5, y: 1.5 },
			end: { x: 2.5, y: 1.5 }
		};

		// SAFETY: Diamond painting uses only the two canvas methods supplied by this focused fixture.
		paintImageEditorCanvasGradient(context as CanvasRenderingContext2D, value, 3, 3);

		const rgbaAt = (x: number, y: number) =>
			Array.from(pixels.slice((y * 3 + x) * 4, (y * 3 + x + 1) * 4));
		expect(rgbaAt(1, 1)).toEqual([0, 0, 0, 255]);
		expect(rgbaAt(2, 1)).toEqual([255, 255, 255, 255]);
		expect(rgbaAt(1, 2)).toEqual([255, 255, 255, 255]);
	});
});
