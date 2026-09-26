import { describe, expect, it } from 'vitest';
import { AUDIO_VOLUME_DB_MAX, AUDIO_VOLUME_DB_MIN } from '../timeline/audio-volume-line';
import { nextClipVolumeKeyboardDb } from './timeline-audio-volume.svelte.ts';

describe('nextClipVolumeKeyboardDb', () => {
	it('steps half a decibel with arrows and three decibels with shift', () => {
		expect(nextClipVolumeKeyboardDb(0, 'ArrowUp', false)).toBeCloseTo(0.5);
		expect(nextClipVolumeKeyboardDb(0, 'ArrowDown', false)).toBeCloseTo(-0.5);
		expect(nextClipVolumeKeyboardDb(0, 'ArrowUp', true)).toBeCloseTo(3);
		expect(nextClipVolumeKeyboardDb(0, 'ArrowDown', true)).toBeCloseTo(-3);
	});

	it('jumps six decibels with PageUp and PageDown', () => {
		expect(nextClipVolumeKeyboardDb(0, 'PageUp', false)).toBeCloseTo(6);
		expect(nextClipVolumeKeyboardDb(0, 'PageDown', false)).toBeCloseTo(-6);
	});

	it('jumps to the volume bounds with Home and End', () => {
		expect(nextClipVolumeKeyboardDb(0, 'Home', false)).toBe(AUDIO_VOLUME_DB_MIN);
		expect(nextClipVolumeKeyboardDb(0, 'End', false)).toBe(AUDIO_VOLUME_DB_MAX);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextClipVolumeKeyboardDb(0, 'Enter', false)).toBeNull();
		expect(nextClipVolumeKeyboardDb(0, 'a', false)).toBeNull();
	});
});
