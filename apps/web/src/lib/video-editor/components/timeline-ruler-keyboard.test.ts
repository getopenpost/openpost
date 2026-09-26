import { describe, expect, it } from 'vitest';
import { nextRulerKeyboardFrame } from './timeline-panel.svelte';

describe('nextRulerKeyboardFrame', () => {
	const fps = 30;
	const maxEnd = 300;

	it('steps one frame with arrows and ten frames with shift', () => {
		expect(nextRulerKeyboardFrame(100, 'ArrowLeft', false, fps, maxEnd)).toBe(99);
		expect(nextRulerKeyboardFrame(100, 'ArrowRight', false, fps, maxEnd)).toBe(101);
		expect(nextRulerKeyboardFrame(100, 'ArrowLeft', true, fps, maxEnd)).toBe(90);
		expect(nextRulerKeyboardFrame(100, 'ArrowRight', true, fps, maxEnd)).toBe(110);
	});

	it('jumps one second of frames with PageUp and PageDown', () => {
		expect(nextRulerKeyboardFrame(100, 'PageUp', false, fps, maxEnd)).toBe(130);
		expect(nextRulerKeyboardFrame(100, 'PageDown', false, fps, maxEnd)).toBe(70);
	});

	it('jumps to the timeline bounds with Home and End', () => {
		expect(nextRulerKeyboardFrame(100, 'Home', false, fps, maxEnd)).toBe(0);
		expect(nextRulerKeyboardFrame(100, 'End', false, fps, maxEnd)).toBe(maxEnd);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextRulerKeyboardFrame(100, 'Enter', false, fps, maxEnd)).toBeNull();
		expect(nextRulerKeyboardFrame(100, 'a', false, fps, maxEnd)).toBeNull();
	});
});
