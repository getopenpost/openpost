import { describe, expect, it } from 'vitest';
import { resolveAudioEqSettings } from './audio-eq';
import { processAudioChannels } from './process-audio';

function sine(frequencyHz: number, frames = 48_000, sampleRate = 48_000): Float32Array {
	return Float32Array.from({ length: frames }, (_, index) =>
		Math.sin(2 * Math.PI * frequencyHz * (index / sampleRate))
	);
}

function rms(samples: Float32Array): number {
	return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

describe('processAudioChannels', () => {
	it('time-stretches stereo as one phase-coherent stream, then applies EQ', async () => {
		const input = sine(80);
		const [left, right] = await processAudioChannels([input, input.slice()], {
			speed: 2,
			pitchShiftSemitones: 0,
			sampleRate: 48_000,
			eqStages: [
				resolveAudioEqSettings({
					band1Enabled: true,
					band1Type: 'high-pass',
					band1FrequencyHz: 180,
					band1SlopeDbPerOct: 24
				})
			]
		});
		expect(left?.length).toBe(24_000);
		expect(right).toEqual(left);
		expect(rms(left!)).toBeLessThan(rms(input) * 0.3);
	});

	it('changes pitch without changing the requested timeline duration', async () => {
		const input = sine(440);
		const [output] = await processAudioChannels([input], {
			speed: 1,
			pitchShiftSemitones: 12,
			sampleRate: 48_000
		});
		expect(output?.length).toBe(48_000);
	});
});
