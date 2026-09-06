import { describe, expect, it } from 'vitest';
import { detectSilentRanges, type AudioBufferLike } from './audio-silence';

function bufferFrom(
	seconds: number,
	sampleRate: number,
	fill: (i: number, t: number) => number
): AudioBufferLike {
	const length = Math.round(seconds * sampleRate);
	const data = new Float32Array(length);
	for (let i = 0; i < length; i++) data[i] = fill(i, i / sampleRate);
	return {
		duration: seconds,
		length,
		numberOfChannels: 1,
		sampleRate,
		getChannelData: () => data
	};
}

describe('detectSilentRanges', () => {
	it('finds the quiet gap between two loud sections', () => {
		// Loud 0-1s, silent 1-3s, loud 3-4s.
		const audio = bufferFrom(4, 8000, (_i, t) =>
			t >= 1 && t < 3 ? 0 : Math.sin(t * 8000 * 0.05) * 0.5
		);
		const ranges = detectSilentRanges(audio, { minSilenceMs: 400, paddingMs: 0 });
		expect(ranges.length).toBe(1);
		const range = ranges[0];
		expect(range?.start).toBeGreaterThanOrEqual(0.95);
		expect(range?.end).toBeLessThanOrEqual(3.05);
	});

	it('returns nothing for continuous loud audio', () => {
		const audio = bufferFrom(2, 8000, (_i, t) => Math.sin(t * 400) * 0.5);
		const ranges = detectSilentRanges(audio, { minSilenceMs: 200 });
		expect(ranges).toEqual([]);
	});

	it('returns everything for digital silence', () => {
		const audio = bufferFrom(2, 8000, () => 0);
		const ranges = detectSilentRanges(audio, { minSilenceMs: 200 });
		expect(ranges.length).toBe(1);
	});

	it('padding keeps quiet margins inside detected ranges', () => {
		const audio = bufferFrom(3, 8000, (_i, t) => (t >= 1 && t < 2 ? 0 : 0.4));
		const padded = detectSilentRanges(audio, { minSilenceMs: 300 });
		const unpadded = detectSilentRanges(audio, { minSilenceMs: 300, paddingMs: 0 });
		const pad = padded[0];
		const raw = unpadded[0];
		// Padding retains silence at the edges, shrinking the removal range.
		if (pad && raw) {
			expect(pad.start).toBeGreaterThan(raw.start);
			expect(pad.end).toBeLessThan(raw.end);
		} else {
			throw new Error('expected both detections');
		}
	});
});
