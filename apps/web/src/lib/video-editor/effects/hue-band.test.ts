import { describe, expect, it } from 'vitest';
import { hueBandGeometry, hueFromStripPosition } from './hue-band';

describe('hueBandGeometry', () => {
	it('centers the bands on the hue value', () => {
		const geometry = hueBandGeometry(180, 36, 12);
		expect(geometry.centerPct).toBeCloseTo(50, 6);
		// Core radius 36/360 = 10%, feather adds 12/360 = 3.33%.
		expect(geometry.coreLeftPct).toBeCloseTo(40, 6);
		expect(geometry.coreRightPct).toBeCloseTo(40, 6);
		expect(geometry.softLeftPct).toBeCloseTo(36.667, 3);
		expect(geometry.softRightPct).toBeCloseTo(36.667, 3);
	});

	it('clamps bands at the strip edges', () => {
		const geometry = hueBandGeometry(0, 36, 12);
		expect(geometry.centerPct).toBe(0);
		expect(geometry.coreLeftPct).toBe(0);
		expect(geometry.softLeftPct).toBe(0);
		expect(geometry.coreRightPct).toBeGreaterThan(0);
	});

	it('clamps out-of-range inputs like the FreeCut control', () => {
		const geometry = hueBandGeometry(720, 400, 500);
		expect(geometry.centerPct).toBe(100);
		// Width clamps to 180 (50%), softness to 120 (33.3%).
		expect(geometry.coreLeftPct).toBe(50);
		expect(geometry.softLeftPct).toBeCloseTo(16.667, 3);
	});
});

describe('hueFromStripPosition', () => {
	it('maps strip pixels to degrees', () => {
		expect(hueFromStripPosition(50, 0, 200)).toBe(90);
		expect(hueFromStripPosition(-10, 0, 200)).toBe(0);
		expect(hueFromStripPosition(300, 0, 200)).toBe(360);
		expect(hueFromStripPosition(10, 0, 0)).toBe(0);
	});
});
