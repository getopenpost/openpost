/**
 * Ported from FreeCut (MIT) - shared/utils/easing.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyEasingConfig, cubicBezier, easeIn, easeInOut, easeOut } from './easing';

describe('timeline easing', () => {
	it('keeps the named curves stable', () => {
		expect(easeIn(0.5)).toBe(0.25);
		expect(easeOut(0.5)).toBe(0.75);
		expect(easeInOut(0.25)).toBe(0.125);
		expect(easeInOut(0.75)).toBe(0.875);
	});

	it('solves cubic bezier curves by their x coordinate', () => {
		expect(cubicBezier(0, { x1: 0.16, y1: 1, x2: 0.3, y2: 1 })).toBe(0);
		expect(cubicBezier(1, { x1: 0.16, y1: 1, x2: 0.3, y2: 1 })).toBe(1);
		expect(cubicBezier(0.5, { x1: 0.42, y1: 0, x2: 0.58, y2: 1 })).toBeCloseTo(0.5, 6);
	});

	it('supports configured spring easing without losing exact endpoints', () => {
		const config = {
			type: 'spring' as const,
			spring: { tension: 220, friction: 18, mass: 0.9 }
		};
		expect(applyEasingConfig(0, config)).toBe(0);
		expect(applyEasingConfig(1, config)).toBe(1);
		for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
			const value = applyEasingConfig(progress, config);
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1.2);
		}
	});
});
