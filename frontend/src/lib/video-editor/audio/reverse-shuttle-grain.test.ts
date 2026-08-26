import { describe, expect, it } from 'vitest';
import { mixerDbToGain } from './mixer-utils';
import {
	copyShuttleGrainSamples,
	resolveReverseShuttleGrainPlan
} from './reverse-shuttle-grain';

describe('reverse shuttle grain', () => {
	it('plans normal clip grain reversed and authored-reversed forward', () => {
		const normal = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: false,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		expect(normal?.reverseSamples).toBe(true);
		expect(normal?.playbackRate).toBe(2);
		expect(normal?.sourceStartSeconds).toBeCloseTo(5 - 0.16);

		const authoredReversed = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 5,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -2,
			authoredReversed: true,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 10
		});
		expect(authoredReversed?.reverseSamples).toBe(false);
		expect(authoredReversed?.sourceStartSeconds).toBe(5);
	});

	it('copies samples in reverse order when required', () => {
		const source = new Float32Array([1, 2, 3, 4]);
		const target = new Float32Array(4);
		copyShuttleGrainSamples(source, target, 0, true);
		expect(target).toEqual(new Float32Array([4, 3, 2, 1]));
		const target2 = new Float32Array(4);
		copyShuttleGrainSamples(source, target2, 0, false);
		expect(target2).toEqual(new Float32Array([1, 2, 3, 4]));
	});

	it('preserves -6.02 dB as 0.5, not double-applied 0.25', () => {
		const gain = mixerDbToGain(-6.02);
		expect(gain).toBeCloseTo(0.5, 2);
		// Simulate double-apply bug: volume * volume would be 0.25
		const doubleApplied = gain * gain;
		expect(doubleApplied).toBeCloseTo(0.25, 2);
		expect(gain).not.toBeCloseTo(doubleApplied, 2);
	});

	it('returns null when grain would exceed buffer', () => {
		const plan = resolveReverseShuttleGrainPlan({
			sourceCursorSeconds: 0.05,
			authoredPlaybackRate: 1,
			transportPlaybackRate: -4,
			authoredReversed: false,
			bufferStartSeconds: 0,
			bufferDurationSeconds: 0.1
		});
		expect(plan).toBeNull();
	});
});
