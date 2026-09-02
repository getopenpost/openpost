import { describe, expect, it } from 'vitest';
import {
	THEME_ASSET_SLOTS,
	THEME_BORDER_STYLES,
	THEME_CANVAS_TREATMENTS,
	THEME_COLOR_TOKEN_KEYS,
	THEME_COMPONENT_RECIPE_KEYS,
	THEME_COMPONENT_RECIPE_OPTIONS,
	THEME_DENSITIES,
	THEME_ICON_PACK_IDS,
	THEME_MOTION_RECIPE_KEYS,
	THEME_REDUCED_MOTION_OPTIONS,
	THEME_TYPOGRAPHY_ROLE_KEYS
} from '$lib/themes';
import {
	themeEditorIconPackLabel,
	themeEditorTokenLabel,
	themeEditorValueLabel
} from './theme-editor-presenter';
import { themePreviewCopy } from './theme-preview-copy';

describe('theme editor presentation', () => {
	it('has a localized label for every token and enum value shown by the editor', () => {
		const tokens = [
			...THEME_COLOR_TOKEN_KEYS,
			...THEME_TYPOGRAPHY_ROLE_KEYS,
			...THEME_MOTION_RECIPE_KEYS,
			...THEME_COMPONENT_RECIPE_KEYS,
			...THEME_ASSET_SLOTS
		];
		const values = [
			...THEME_DENSITIES,
			...THEME_BORDER_STYLES,
			...THEME_CANVAS_TREATMENTS,
			...THEME_REDUCED_MOTION_OPTIONS,
			...Object.values(THEME_COMPONENT_RECIPE_OPTIONS).flat(),
			'normal',
			'italic',
			'swap',
			'fallback',
			'optional'
		];

		for (const token of new Set(tokens)) {
			expect(themeEditorTokenLabel(token, 'en'), token).not.toBe(token);
		}
		for (const value of new Set(values)) {
			expect(themeEditorValueLabel(value, 'en'), value).not.toBe(value);
		}
		for (const pack of THEME_ICON_PACK_IDS) {
			expect(themeEditorIconPackLabel(pack, 'en'), pack).not.toBe(pack);
		}
	});

	it('formats preview metrics with the selected locale', () => {
		expect(themePreviewCopy('en').tableRows[0].reach).toBe('12.4K');
		expect(themePreviewCopy('de').tableRows[0].reach).toBe('12.400');
		expect(themePreviewCopy('ja').tableRows[0].reach).toBe('1.2万');
	});
});
