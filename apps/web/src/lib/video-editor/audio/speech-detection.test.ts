import { describe, expect, it } from 'vitest';
import { nonSpeechRanges, intersectQuietRanges } from './speech-detection';

describe('speech-only cut proposals', () => {
	it('keeps speech and breathing room while proposing long non-speech gaps', () => {
		const confidence = new Float32Array(125);
		confidence.fill(0.95, 32, 64);
		const ranges = nonSpeechRanges(confidence, 4, {
			minSilenceMs: 300,
			paddingStartMs: 96,
			paddingEndMs: 96
		});
		expect(ranges).toEqual([
			{ start: 0.096, end: 0.928 },
			{ start: 2.144, end: 3.904 }
		]);
	});
	it('does not cut brief pauses or speech present on another channel', () => {
		const confidence = new Float32Array(125).fill(0.95);
		confidence.fill(0.05, 32, 36);
		expect(nonSpeechRanges(confidence, 4)).toEqual([]);
		expect(
			intersectQuietRanges(
				[
					{ start: 0, end: 2 },
					{ start: 3, end: 4 }
				],
				[{ start: 1, end: 3.5 }]
			)
		).toEqual([
			{ start: 1, end: 2 },
			{ start: 3, end: 3.5 }
		]);
	});
});
