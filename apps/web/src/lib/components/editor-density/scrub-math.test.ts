import { describe, expect, it } from 'vitest';
import {
	clampValue,
	formatFixed,
	nudgeValue,
	parseNumeric,
	scrubValue,
	stepsFromPixels
} from './scrub-math';

describe('stepsFromPixels', () => {
	it('counts one step per 4px from the press pixel', () => {
		expect(stepsFromPixels(0)).toBe(0);
		expect(stepsFromPixels(3)).toBe(1);
		expect(stepsFromPixels(4)).toBe(1);
		expect(stepsFromPixels(8)).toBe(2);
		expect(stepsFromPixels(-4)).toBe(-1);
		// Math.round rounds halves toward +Infinity, so -6px lands on -1.
		expect(stepsFromPixels(-6)).toBe(-1);
		expect(stepsFromPixels(-7)).toBe(-2);
	});

	it('applies Shift x5 and Alt x0.2 stride modifiers', () => {
		expect(stepsFromPixels(4, { shift: true })).toBe(5);
		expect(stepsFromPixels(20, { alt: true })).toBe(1);
		expect(stepsFromPixels(20, { shift: true, alt: true })).toBe(5);
	});
});

describe('scrubValue', () => {
	it('restores the exact start value at the press pixel', () => {
		expect(scrubValue(10.3, 0, 0.5)).toBe(10.3);
		expect(scrubValue(10.3, 1, 0.5)).toBe(10.3);
	});

	it('moves in whole steps and clamps to bounds', () => {
		expect(scrubValue(10, 8, 1)).toBe(12);
		expect(scrubValue(10, -4, 2.5)).toBe(7.5);
		expect(scrubValue(98, 40, 1, {}, 0, 100)).toBe(100);
		expect(scrubValue(2, -40, 1, {}, 0, 100)).toBe(0);
	});
});

describe('nudgeValue', () => {
	it('nudges one step per arrow press with modifiers', () => {
		expect(nudgeValue(10, 1, 1)).toBe(11);
		expect(nudgeValue(10, -1, 0.5)).toBe(9.5);
		expect(nudgeValue(10, 1, 1, { shift: true })).toBe(15);
		expect(nudgeValue(10, 1, 1, { alt: true })).toBeCloseTo(10.2, 10);
		expect(nudgeValue(0, -1, 1, {}, 0)).toBe(0);
	});
});

describe('clampValue and formatting', () => {
	it('clamps only against provided bounds', () => {
		expect(clampValue(5)).toBe(5);
		expect(clampValue(-5, 0)).toBe(0);
		expect(clampValue(150, undefined, 100)).toBe(100);
	});

	it('never renders negative zero', () => {
		expect(formatFixed(-0.0001, 2)).toBe('0.00');
		expect(formatFixed(1.235, 2)).toBe('1.24');
	});
});

describe('parseNumeric', () => {
	it('rejects empty and non-finite input', () => {
		expect(parseNumeric('')).toBeNull();
		expect(parseNumeric('   ')).toBeNull();
		expect(parseNumeric('abc')).toBeNull();
		expect(parseNumeric('12px')).toBeNull();
		expect(parseNumeric('3.5')).toBe(3.5);
		expect(parseNumeric('-12')).toBe(-12);
	});
});
