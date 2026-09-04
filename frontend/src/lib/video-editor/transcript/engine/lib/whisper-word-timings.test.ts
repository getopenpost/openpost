import { describe, expect, it } from 'vitest';
import { resolveWhisperWordTimings } from './whisper-word-timings';

describe('resolveWhisperWordTimings', () => {
	it('uses the next known start for a missing end timestamp', () => {
		expect(
			resolveWhisperWordTimings(
				[
					{ text: 'one', timestamp: [1, null] },
					{ text: 'two', timestamp: [1.6, 2] }
				],
				0,
				10
			)[0]
		).toEqual({ text: 'one', start: 1, end: 1.6 });
	});

	it('preserves a fully open final word at the chunk boundary', () => {
		expect(
			resolveWhisperWordTimings(
				[
					{ text: 'before', timestamp: [11.5, 12] },
					{ text: 'boundary', timestamp: [null, null] }
				],
				118,
				12
			)
		).toEqual([
			{ text: 'before', start: 129.5, end: 130 },
			{ text: 'boundary', start: 129.99, end: 130 }
		]);
	});
});
