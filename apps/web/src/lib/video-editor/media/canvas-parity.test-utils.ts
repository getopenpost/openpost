import { expect } from 'vitest';

/**
 * DOM and offscreen canvases can round antialiased edge colors differently.
 * Keep the allowance small enough to catch layout, style, and compositing drift.
 */
export function expectCanvasRasterParity(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray
): void {
	expect(actual.length).toBe(expected.length);
	let changedColorChannels = 0;
	let totalColorDifference = 0;
	let maximumColorDifference = 0;
	let changedAlphaChannels = 0;
	for (let index = 0; index < actual.length; index += 4) {
		for (let channel = 0; channel < 3; channel += 1) {
			const difference = Math.abs(
				(actual[index + channel] ?? 0) - (expected[index + channel] ?? 0)
			);
			if (difference > 0) changedColorChannels += 1;
			totalColorDifference += difference;
			maximumColorDifference = Math.max(maximumColorDifference, difference);
		}
		if (actual[index + 3] !== expected[index + 3]) changedAlphaChannels += 1;
	}
	const colorChannelCount = (actual.length / 4) * 3;
	const meanColorDifference = totalColorDifference / colorChannelCount;
	const changedColorRatio = changedColorChannels / colorChannelCount;
	const metrics = JSON.stringify({
		maximumColorDifference,
		meanColorDifference,
		changedColorRatio,
		changedAlphaChannels
	});
	expect.soft(changedAlphaChannels, metrics).toBe(0);
	expect.soft(maximumColorDifference, metrics).toBeLessThanOrEqual(16);
	expect.soft(meanColorDifference, metrics).toBeLessThanOrEqual(0.25);
	expect.soft(changedColorRatio, metrics).toBeLessThanOrEqual(0.1);
}
