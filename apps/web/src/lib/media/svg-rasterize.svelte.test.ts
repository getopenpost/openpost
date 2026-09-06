import { describe, expect, it } from 'vitest';
import { isSVGFile, rasterizeSVGToPNG } from './svg-rasterize';

describe('SVG upload rasterization', () => {
	it('recognizes SVG MIME types and extensions', () => {
		expect(isSVGFile(new File(['<svg/>'], 'mark.svg', { type: 'image/svg+xml' }))).toBe(true);
		expect(isSVGFile(new File(['<svg/>'], 'mark.svg', { type: '' }))).toBe(true);
		expect(isSVGFile(new File(['png'], 'mark.png', { type: 'image/png' }))).toBe(false);
	});

	it('converts an SVG into a transparent PNG with a raster filename', async () => {
		const svg = new File(
			[
				'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#f97316"/></svg>'
			],
			'launch-card.svg',
			{ type: 'image/svg+xml', lastModified: 123 }
		);

		const png = await rasterizeSVGToPNG(svg);

		expect(png.name).toBe('launch-card.png');
		expect(png.type).toBe('image/png');
		expect(png.lastModified).toBe(123);
		expect(png.size).toBeGreaterThan(0);
		const signature = new Uint8Array(await png.slice(0, 8).arrayBuffer());
		expect(Array.from(signature)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	});
});
