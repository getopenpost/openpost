import { describe, expect, it } from 'vitest';
import { gradientColorAt, gradientRatioAtPoint, normalizedGradientStops } from './gradient';
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
});
