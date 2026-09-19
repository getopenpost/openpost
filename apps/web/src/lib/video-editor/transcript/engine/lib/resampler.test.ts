import { describe, expect, it } from 'vitest';
import { downmixToMono } from './resampler';

describe('transcription channel mix', () => {
	it('retains speakers recorded on separate channels and prevents phase cancellation', () => {
		const left = new Float32Array([0.5, -0.5, 0, 0]);
		const right = new Float32Array([0, 0, 0.2, -0.2]);
		expect(Array.from(downmixToMono([left, right]))).toEqual([
			0.25,
			-0.25,
			expect.closeTo(0.1),
			expect.closeTo(-0.1)
		]);
		expect(downmixToMono([left, left.map((value) => -value)])).toEqual(left);
	});
});
