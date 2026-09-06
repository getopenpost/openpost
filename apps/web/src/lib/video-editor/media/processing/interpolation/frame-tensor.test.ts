// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { concatPlanarPair, framesDiffer } from './frame-tensor';

describe('concatPlanarPair', () => {
	it('does not alias its operands', () => {
		const left = new Float32Array(3).fill(1);
		const right = new Float32Array(3).fill(0);
		const packed = concatPlanarPair(left, right, 1, 1);
		packed[0] = 0.5;
		expect(left[0]).toBe(1);
	});

	it('reports no difference for identical frames', () => {
		const a = new Float32Array([0.1, 0.2, 0.3]);
		expect(framesDiffer(a, Float32Array.from(a), 0)).toBe(false);
	});

	it('rejects frames of different lengths', () => {
		expect(() => framesDiffer(new Float32Array(3), new Float32Array(4), 0)).toThrow(
			/length mismatch, 3 vs 4/
		);
	});
});
