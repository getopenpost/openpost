import { describe, expect, it } from 'vitest';
import {
	BUNDLED_THEME_FONTS,
	BUNDLED_THEME_FONT_IDS,
	bundledThemeFont,
	isAvailableThemeFontFamily
} from './bundled-fonts.js';

describe('bundled theme fonts', () => {
	it('provides one complete editor option for every approved bundled family', () => {
		expect(Object.keys(BUNDLED_THEME_FONTS)).toEqual(BUNDLED_THEME_FONT_IDS);

		for (const id of BUNDLED_THEME_FONT_IDS) {
			const font = bundledThemeFont(id);
			expect(font.id).toBe(id);
			expect(font.family.length).toBeGreaterThan(0);
			expect(font.fallbacks.length).toBeGreaterThan(0);
			expect(font.weights.length).toBeGreaterThan(0);
			for (const weight of font.weights) {
				expect(weight).toBeGreaterThanOrEqual(100);
				expect(weight).toBeLessThanOrEqual(900);
				expect(weight % 100).toBe(0);
			}
		}
	});

	it('allows a bundled family or a family backed by an uploaded face', () => {
		expect(isAvailableThemeFontFamily('Geist Variable', [])).toBe(true);
		expect(
			isAvailableThemeFontFamily('Organization Sans', [
				{
					id: 'organization-sans-400',
					family: 'Organization Sans',
					sourceUrl: '/api/v1/theme-assets/opaque-id/content?organization_id=organization-id',
					format: 'woff2',
					weight: 400,
					style: 'normal',
					display: 'swap'
				}
			])
		).toBe(true);
		expect(isAvailableThemeFontFamily('Unapproved Remote Font', [])).toBe(false);
	});
});
