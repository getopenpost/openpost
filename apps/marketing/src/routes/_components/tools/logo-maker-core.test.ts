// @vitest-environment jsdom

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { exportSizes, logoIconMetadata, serializeLogoSvg } from './logo-maker-core';

function logoFixture(): SVGSVGElement {
	const document = new DOMParser().parseFromString(
		'<svg class="preview" aria-label="Logo preview" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f97316"/><circle cx="50" cy="50" r="20" fill="#2563eb"/></svg>',
		'image/svg+xml'
	);
	const svg = document.querySelector('svg');
	if (!svg) throw new Error('The SVG fixture could not be parsed.');
	return svg;
}

describe('logo maker output', () => {
	it('offers a broad, searchable Lucide catalogue', () => {
		expect(Object.keys(logoIconMetadata).length).toBeGreaterThanOrEqual(40);
		expect(logoIconMetadata.rocket).toContain('launch startup space');
		expect(logoIconMetadata.shoppingBag).toContain('store retail ecommerce');
	});

	it.each(exportSizes)('serializes a clean %d px SVG from the rendered preview', (size) => {
		const svg = serializeLogoSvg(logoFixture(), size);

		expect(svg).toContain(`width="${size}"`);
		expect(svg).toContain(`height="${size}"`);
		expect(svg).toContain('viewBox="0 0 100 100"');
		expect(svg).not.toContain('class="preview"');
		expect(svg).not.toContain('aria-label');
	});

	it('rasterizes the serialized SVG at the requested size with matching pixels', async () => {
		const svg = serializeLogoSvg(logoFixture(), 512);
		const { data, info } = await sharp(Buffer.from(svg))
			.png()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const pixel = (x: number, y: number) =>
			Array.from(
				data.subarray(
					(y * info.width + x) * info.channels,
					(y * info.width + x) * info.channels + 4
				)
			);

		expect(info).toMatchObject({ width: 512, height: 512, channels: 4 });
		expect(pixel(8, 8)).toEqual([249, 115, 22, 255]);
		expect(pixel(256, 256)).toEqual([37, 99, 235, 255]);
	});
});
