import { describe, expect, it } from 'vitest';
import { integratedLoudness, loudnessGain } from './analysis';

describe('OpenPost Video Editor loudness analysis', () => {
	it('applies absolute and relative block gates', () => {
		const loud = Math.pow(10, (-18 + 0.691) / 10);
		const quiet = Math.pow(10, (-60 + 0.691) / 10);
		expect(integratedLoudness([loud, loud, loud, quiet])).toBeCloseTo(-18, 1);
	});

	it('targets -14 LUFS while respecting the -1 dB peak ceiling', () => {
		expect(loudnessGain(-20, 0.4)).toBeCloseTo(6, 1);
		expect(loudnessGain(-20, 0.89)).toBeLessThanOrEqual(0.02);
		expect(loudnessGain(-5, 0.5)).toBeCloseTo(-9, 1);
	});
});
