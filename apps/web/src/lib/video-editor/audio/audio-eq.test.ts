import { describe, expect, it } from 'vitest';
import {
	AUDIO_EQ_PRESETS,
	applyAudioEqStages,
	findAudioEqPresetId,
	getAudioEqResponseGainDb,
	prependResolvedAudioEqSources,
	resolveAudioEqSettings
} from './audio-eq';

function sine(frequencyHz: number, sampleRate = 48_000, seconds = 0.25): Float32Array {
	return Float32Array.from({ length: sampleRate * seconds }, (_, index) =>
		Math.sin(2 * Math.PI * frequencyHz * (index / sampleRate))
	);
}

function rms(samples: Float32Array): number {
	return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

describe('audio EQ', () => {
	it('keeps outer-to-inner stage order and omits disabled sources', () => {
		const clip = resolveAudioEqSettings({ highMidGainDb: 3 });
		expect(
			prependResolvedAudioEqSources([clip], { lowGainDb: 2 }, { enabled: false, highGainDb: 8 })
		).toEqual([resolveAudioEqSettings({ lowGainDb: 2 }), clip]);
	});

	it('uses the same response math and sample processor for a steep rumble cut', () => {
		const stage = resolveAudioEqSettings({
			band1Enabled: true,
			band1Type: 'high-pass',
			band1FrequencyHz: 120,
			band1SlopeDbPerOct: 24
		});
		expect(getAudioEqResponseGainDb(stage, 40)).toBeLessThan(-20);
		const source = sine(40);
		const output = applyAudioEqStages([source], 48_000, [stage])[0]!;
		expect(rms(output)).toBeLessThan(rms(source) * 0.2);
	});
});
