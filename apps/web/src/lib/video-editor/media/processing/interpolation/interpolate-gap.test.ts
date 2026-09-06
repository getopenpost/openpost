// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { interpolateGap } from './interpolate-gap';
import { SUPPORTED_INTERPOLATION_FACTORS } from './interpolation-factor';

/**
 * A real phase interpolator: the exact linear blend at `t`. A correct schedule over a linear
 * ramp reproduces the ramp, so every synthesized position is analytically known — this checks
 * the schedule, not a mock.
 */
const lerp = async (left: Float32Array, right: Float32Array, t: number): Promise<Float32Array> =>
	left.map((value, i) => value + (right[i]! - value) * t);

const ramp = (from: number, to: number): [Float32Array, Float32Array] => [
	new Float32Array([from]),
	new Float32Array([to])
];

describe('interpolateGap', () => {
	it('places each frame at its nominal fraction of the gap', async () => {
		const [a, b] = ramp(0, 1);
		for (const factor of SUPPORTED_INTERPOLATION_FACTORS) {
			const positions = (await interpolateGap(a, b, factor, lerp)).map((f) => f[0]!);
			positions.forEach((value, i) => expect(value).toBeCloseTo((i + 1) / factor, 6));
		}
	});

	it('handles factors that are not powers of two', async () => {
		const positions = (await interpolateGap(...ramp(0, 3), 3, lerp)).map((f) => f[0]!);
		expect(positions[0]).toBeCloseTo(1, 6);
		expect(positions[1]).toBeCloseTo(2, 6);
	});

	it('runs exactly factor-1 inferences', async () => {
		let calls = 0;
		const counted = async (l: Float32Array, r: Float32Array, t: number): Promise<Float32Array> => {
			calls++;
			return lerp(l, r, t);
		};
		await interpolateGap(...ramp(0, 1), 8, counted);
		expect(calls).toBe(7);
	});

	it('propagates interpolator failures', async () => {
		const failing = async (): Promise<Float32Array> => {
			throw new Error('inference exploded');
		};
		await expect(interpolateGap(...ramp(0, 1), 4, failing)).rejects.toThrow('inference exploded');
	});
});
