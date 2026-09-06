import { describe, expect, it } from 'vitest';
import {
	clampAudioPitchCents,
	clampAudioPitchSemitones,
	getAudioPitchRatioFromSemitones,
	getAudioPitchShiftSemitones,
	resolvePreviewAudioPitchShiftSemitones
} from './audio-pitch';

describe('audio pitch', () => {
	it('clamps persisted controls and combines semitones with cents', () => {
		expect(clampAudioPitchSemitones(18)).toBe(12);
		expect(clampAudioPitchSemitones(-14)).toBe(-12);
		expect(clampAudioPitchCents(140)).toBe(100);
		expect(clampAudioPitchCents(-180)).toBe(-100);
		expect(
			getAudioPitchShiftSemitones({
				audioPitchSemitones: 3,
				audioPitchCents: 25
			})
		).toBe(3.25);
	});

	it('keeps inherited pitch while preview fields replace only local controls', () => {
		expect(
			resolvePreviewAudioPitchShiftSemitones({
				base: { audioPitchSemitones: 2, audioPitchCents: 30 },
				preview: { audioPitchCents: -50 },
				additionalSemitones: 1.5
			})
		).toBe(3);
		expect(getAudioPitchRatioFromSemitones(12)).toBeCloseTo(2, 6);
		expect(getAudioPitchRatioFromSemitones(-12)).toBeCloseTo(0.5, 6);
	});
});
