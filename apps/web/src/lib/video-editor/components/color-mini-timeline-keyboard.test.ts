import { describe, expect, it } from 'vitest';
import { nextKeyboardFrame } from '$lib/video-editor/timeline/keyboard-frame';

describe('nextKeyboardFrame', () => {
	const fps = 30;
	const maxFrame = 300;

	it('steps one frame with arrows and ten frames with shift', () => {
		expect(nextKeyboardFrame(100, 'ArrowLeft', false, fps, maxFrame)).toBe(99);
		expect(nextKeyboardFrame(100, 'ArrowRight', false, fps, maxFrame)).toBe(101);
		expect(nextKeyboardFrame(100, 'ArrowLeft', true, fps, maxFrame)).toBe(90);
		expect(nextKeyboardFrame(100, 'ArrowRight', true, fps, maxFrame)).toBe(110);
	});

	it('jumps one second of frames with PageUp and PageDown', () => {
		expect(nextKeyboardFrame(100, 'PageUp', false, fps, maxFrame)).toBe(130);
		expect(nextKeyboardFrame(100, 'PageDown', false, fps, maxFrame)).toBe(70);
	});

	it('jumps to the timeline bounds with Home and End', () => {
		expect(nextKeyboardFrame(100, 'Home', false, fps, maxFrame)).toBe(0);
		expect(nextKeyboardFrame(100, 'End', false, fps, maxFrame)).toBe(maxFrame);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextKeyboardFrame(100, 'Enter', false, fps, maxFrame)).toBeNull();
		expect(nextKeyboardFrame(100, 'a', false, fps, maxFrame)).toBeNull();
	});
});
