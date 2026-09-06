import { describe, expect, it } from 'vitest';
import { buildScopeBins, luma709, vectorscopeCoordinate } from './scopes';

describe('scope bins', () => {
	it('places black and white at the matching histogram ends', () => {
		const bins = buildScopeBins(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
		expect(bins.histogram.luma[0]).toBe(1);
		expect(bins.histogram.luma[255]).toBe(1);
	});

	it('uses BT.709 luma for browser-composited frames', () => {
		expect(Math.round(luma709(255, 0, 0))).toBe(54);
		expect(Math.round(luma709(0, 255, 0))).toBe(182);
		expect(Math.round(luma709(0, 0, 255))).toBe(18);

		const bins = buildScopeBins(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
		expect(bins.histogram.luma[54]).toBe(1);
		expect(bins.histogram.luma[76]).toBe(0);
	});

	it('reads only the declared frame instead of trailing buffer bytes', () => {
		const bins = buildScopeBins(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 1, 1);
		expect(bins.histogram.luma.reduce((sum, value) => sum + value, 0)).toBe(1);
		expect(bins.histogram.luma[0]).toBe(1);
		expect(bins.histogram.luma[255]).toBe(0);
	});
});
