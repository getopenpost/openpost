import { describe, expect, it } from 'vitest';
import { formatSplitPositionText, nextSplitKeyboardPosition } from './preview-player.svelte';

describe('nextSplitKeyboardPosition', () => {
	it('steps one percent with arrows and ten percent with shift', () => {
		expect(nextSplitKeyboardPosition(0.5, 'ArrowLeft', false)).toBeCloseTo(0.49);
		expect(nextSplitKeyboardPosition(0.5, 'ArrowRight', false)).toBeCloseTo(0.51);
		expect(nextSplitKeyboardPosition(0.5, 'ArrowLeft', true)).toBeCloseTo(0.4);
		expect(nextSplitKeyboardPosition(0.5, 'ArrowRight', true)).toBeCloseTo(0.6);
	});

	it('jumps ten percent with PageUp and PageDown', () => {
		expect(nextSplitKeyboardPosition(0.5, 'PageUp', false)).toBeCloseTo(0.6);
		expect(nextSplitKeyboardPosition(0.5, 'PageDown', false)).toBeCloseTo(0.4);
	});

	it('jumps to the slider bounds with Home and End', () => {
		expect(nextSplitKeyboardPosition(0.5, 'Home', false)).toBe(0.05);
		expect(nextSplitKeyboardPosition(0.5, 'End', false)).toBe(0.95);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextSplitKeyboardPosition(0.5, 'Enter', false)).toBeNull();
		expect(nextSplitKeyboardPosition(0.5, 'a', false)).toBeNull();
	});
});

describe('formatSplitPositionText', () => {
	it('announces the position as a percent instead of a bare number', () => {
		expect(formatSplitPositionText(0.5)).toBe('50%');
		expect(formatSplitPositionText(0.05)).toBe('5%');
		expect(formatSplitPositionText(0.95)).toBe('95%');
	});
});
