import { describe, expect, it } from 'vitest';
import { buildScopeBins, luma709, normalizeScopeValue, vectorscopeCoordinate } from './scopes';

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

describe('scope range normalization', () => {
	it('passes full-range values through clamped to 0-1', () => {
		expect(normalizeScopeValue(0.5, 'full')).toBe(0.5);
		expect(normalizeScopeValue(-0.2, 'full')).toBe(0);
		expect(normalizeScopeValue(1.4, 'full')).toBe(1);
	});

	it('remaps studio-swing 16-235 into 0-1 for legal range', () => {
		expect(normalizeScopeValue(16 / 255, 'legal')).toBe(0);
		expect(normalizeScopeValue(235 / 255, 'legal')).toBe(1);
		expect(normalizeScopeValue(0, 'legal')).toBe(0);
		expect(normalizeScopeValue(1, 'legal')).toBe(1);
		expect(normalizeScopeValue((16 + 235) / 2 / 255, 'legal')).toBeCloseTo(0.5, 5);
	});
});
