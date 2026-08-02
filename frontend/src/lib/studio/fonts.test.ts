import { describe, expect, it } from 'vitest';
import { hasRegisteredStudioBrandFont } from './fonts';
import type { StudioBrandFont } from './types';

const bangers: StudioBrandFont = {
	id: 'font-1',
	media_id: 'media-1',
	family: 'Bangers',
	css_family: 'OpenPostBrand_media1',
	weight: 400,
	style: 'normal'
};

describe('Studio brand fonts', () => {
	it('does not treat an unregistered family as loaded', () => {
		expect(hasRegisteredStudioBrandFont(bangers, [])).toBe(false);
	});

	it('recognizes the exact registered family, weight, and style', () => {
		expect(
			hasRegisteredStudioBrandFont(bangers, [
				{ family: '"OpenPostBrand_media1"', weight: '400', style: 'normal' }
			])
		).toBe(true);
		expect(
			hasRegisteredStudioBrandFont(bangers, [
				{ family: 'OpenPostBrand_media1', weight: '700', style: 'normal' }
			])
		).toBe(false);
	});
});
