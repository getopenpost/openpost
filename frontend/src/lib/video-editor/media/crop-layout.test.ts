import { describe, expect, it } from 'vitest';
import { calculateMediaCropLayout, hasCropFeather } from './crop-layout';

describe('calculateMediaCropLayout', () => {
	it('keeps the cropped source in place instead of stretching it back to the item bounds', () => {
		const layout = calculateMediaCropLayout(
			1000,
			500,
			1000,
			500,
			{ left: 0.1, right: 0.2, top: 0.25, bottom: 0.25 },
			'fill'
		);
		expect(layout.mediaRect).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
		expect(layout.cropViewportRect).toEqual({ x: 100, y: 125, width: 700, height: 250 });
	});

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
