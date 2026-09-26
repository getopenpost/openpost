import { describe, expect, it } from 'vitest';
import { AUDIO_FADE_CURVE_X_DEFAULT } from '../timeline/fade-handles';
import { nextCurveKeyboard, nextFadeKeyboardSeconds } from './timeline-fade-handles.svelte';

const curveKey = (
	curve: number,
	curveX: number,
	key: string,
	shiftKey: boolean
): { curve: number; curveX: number } | null =>
	nextCurveKeyboard(curve, curveX, key, shiftKey, AUDIO_FADE_CURVE_X_DEFAULT);

describe('nextFadeKeyboardSeconds', () => {
	const fps = 30;
	const max = 10;

	it('steps one frame with arrows and ten frames with shift', () => {
		expect(nextFadeKeyboardSeconds(2, 'ArrowRight', false, fps, max, 'in')).toBeCloseTo(
			2 + 1 / fps
		);
		expect(nextFadeKeyboardSeconds(2, 'ArrowLeft', false, fps, max, 'in')).toBeCloseTo(2 - 1 / fps);
		expect(nextFadeKeyboardSeconds(2, 'ArrowRight', true, fps, max, 'in')).toBeCloseTo(
			2 + 10 / fps
		);
		// The fade-out handle mirrors left/right so outward always grows the fade.
		expect(nextFadeKeyboardSeconds(2, 'ArrowLeft', false, fps, max, 'out')).toBeCloseTo(
			2 + 1 / fps
		);
		expect(nextFadeKeyboardSeconds(2, 'ArrowRight', false, fps, max, 'out')).toBeCloseTo(
			2 - 1 / fps
		);
	});

	it('jumps one second with PageUp and PageDown regardless of handle', () => {
		expect(nextFadeKeyboardSeconds(2, 'PageUp', false, fps, max, 'in')).toBeCloseTo(3);
		expect(nextFadeKeyboardSeconds(2, 'PageDown', false, fps, max, 'in')).toBeCloseTo(1);
		expect(nextFadeKeyboardSeconds(2, 'PageUp', false, fps, max, 'out')).toBeCloseTo(3);
		expect(nextFadeKeyboardSeconds(2, 'PageDown', false, fps, max, 'out')).toBeCloseTo(1);
	});

	it('jumps to no-fade and max-fade with Home and End', () => {
		expect(nextFadeKeyboardSeconds(2, 'Home', false, fps, max, 'in')).toBe(0);
		expect(nextFadeKeyboardSeconds(2, 'End', false, fps, max, 'in')).toBe(max);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextFadeKeyboardSeconds(2, 'Enter', false, fps, max, 'in')).toBeNull();
		expect(nextFadeKeyboardSeconds(2, 'a', false, fps, max, 'out')).toBeNull();
	});
});

describe('nextCurveKeyboard', () => {
	it('nudges curve and bias with arrows', () => {
		expect(curveKey(0, 0.52, 'ArrowUp', false)?.curve).toBeCloseTo(0.05);
		expect(curveKey(0, 0.52, 'ArrowDown', false)?.curve).toBeCloseTo(-0.05);
		expect(curveKey(0, 0.52, 'ArrowRight', false)?.curveX).toBeCloseTo(0.54);
		expect(curveKey(0, 0.52, 'ArrowLeft', true)?.curveX).toBeCloseTo(0.48);
	});

	it('moves ten arrow steps with PageUp and PageDown', () => {
		expect(curveKey(0, 0.52, 'PageUp', false)?.curve).toBeCloseTo(0.5);
		expect(curveKey(0, 0.52, 'PageDown', false)?.curve).toBeCloseTo(-0.5);
		expect(curveKey(0, 0.52, 'PageUp', true)?.curve).toBeCloseTo(1);
	});

	it('resets with Home and pins to full with End', () => {
		expect(curveKey(0.4, 0.7, 'Home', false)).toEqual({
			curve: 0,
			curveX: AUDIO_FADE_CURVE_X_DEFAULT
		});
		expect(curveKey(0.4, 0.7, 'End', false)).toEqual({ curve: 1, curveX: 0.96 });
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(curveKey(0, 0.52, 'Enter', false)).toBeNull();
		expect(curveKey(0, 0.52, 'a', false)).toBeNull();
	});
});
