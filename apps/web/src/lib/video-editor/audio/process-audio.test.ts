import { describe, expect, it } from 'vitest';
import { resolveAudioEqSettings, StreamingAudioEq } from './audio-eq';
import { StreamingTimeStretch } from './process-audio';

function sine(frequencyHz: number, frames = 48_000, sampleRate = 48_000): Float32Array {
	return Float32Array.from({ length: frames }, (_, index) =>
		Math.sin(2 * Math.PI * frequencyHz * (index / sampleRate))
	);
}

function rms(samples: Float32Array): number {
	return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

describe('streaming audio processing', () => {
	it('time-stretches stereo as one phase-coherent stream, then applies EQ', async () => {
		const input = sine(80);
		const stretch = await StreamingTimeStretch.create(2, 2, 1);
		const first = stretch.process([input.subarray(0, 24000), input.subarray(0, 24000)]);
		const last = stretch.process([input.subarray(24000), input.subarray(24000)], true);
		const eq = new StreamingAudioEq(2, 48_000, [
			resolveAudioEqSettings({
				band1Enabled: true,
				band1Type: 'high-pass',
				band1FrequencyHz: 180,
				band1SlopeDbPerOct: 24
			})
		]);
		const processed = [eq.process(first), eq.process(last)];
		const [left, right] = [0, 1].map((channel) =>
			Float32Array.from([...processed[0]![channel]!, ...processed[1]![channel]!])
		);

		expect(left?.length).toBe(24_000);
		expect(right).toEqual(left);
		expect(rms(left!)).toBeLessThan(rms(input) * 0.3);
	});

	it('changes pitch without changing the requested timeline duration', async () => {
		const input = sine(440);
		const stretch = await StreamingTimeStretch.create(1, 1, 2);
		const [output] = stretch.process([input], true);

		expect(output?.length).toBe(48_000);
		const interior = output!.subarray(8000, 40000);
		let crossings = 0;
		for (let i = 1; i < interior.length; i++)
			if (interior[i - 1]! < 0 && interior[i]! >= 0) crossings++;
		expect((crossings * 48000) / interior.length).toBeCloseTo(880, -1);
	});
});
