import { describe, expect, it } from 'vitest';
import { hasRegisteredImageEditorBrandFont } from './fonts';
import type { ImageEditorBrandFont } from './types';

const bangers: ImageEditorBrandFont = {
	id: 'font-1',
	media_id: 'media-1',
	family: 'Bangers',
	css_family: 'OpenPostBrand_media1',
	weight: 400,
	style: 'normal'
};

describe('OpenPost Image Editor brand fonts', () => {
	it('does not treat an unregistered family as loaded', () => {
		expect(hasRegisteredImageEditorBrandFont(bangers, [])).toBe(false);
	});

	it('recognizes the exact registered family, weight, and style', () => {
		expect(
			hasRegisteredImageEditorBrandFont(bangers, [
				{ family: '"OpenPostBrand_media1"', weight: '400', style: 'normal' }
			])
		).toBe(true);
		expect(
			hasRegisteredImageEditorBrandFont(bangers, [
				{ family: 'OpenPostBrand_media1', weight: '700', style: 'normal' }
			])
		).toBe(false);
	});
});
