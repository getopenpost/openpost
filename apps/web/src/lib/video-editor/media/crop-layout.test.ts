import { describe, expect, it } from 'vitest';
import { calculateMediaCropLayout, hasCropFeather } from './crop-layout';

describe('calculateMediaCropLayout', () => {
	it('uses the smaller rendered dimension for signed softness', () => {
		const inner = calculateMediaCropLayout(
			1920,
			1080,
			400,
			225,
			{ left: 0.2, right: 0, top: 0, bottom: 0, softness: -0.1 },
			'fill'
		);
		const outer = calculateMediaCropLayout(
			1920,
			1080,
			400,
			225,
			{ left: 0.2, right: 0, top: 0, bottom: 0, softness: 0.1 },
			'fill'
		);

		expect(inner.viewportRect.x).toBe(80);
		expect(inner.featherPixels.left).toBe(22.5);
		expect(outer.viewportRect.x).toBe(57);
		expect(outer.featherPixels.left).toBe(22.5);
		expect(hasCropFeather(outer.featherPixels)).toBe(true);
	});
});
