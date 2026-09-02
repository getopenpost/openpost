import { describe, expect, it } from 'vitest';
import { THEME_ICON_PACK_IDS, THEME_ICON_ROLES } from '../contracts.js';
import { loadThemeIconPack } from './registry.js';

describe('theme icon registry', () => {
	it('maps every semantic role in every selectable pack', async () => {
		for (const packId of THEME_ICON_PACK_IDS) {
			const pack = await loadThemeIconPack(packId);
			expect(pack.id).toBe(packId);
			expect(Object.keys(pack.icons).sort()).toEqual([...THEME_ICON_ROLES].sort());
			for (const role of THEME_ICON_ROLES) {
				expect(pack.icons[role].body).toContain('<');
				expect(pack.icons[role].viewBox).toMatch(
					/^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/
				);
			}
		}
	});

	it('keeps protected identity, status, media, and editor glyphs outside theme packs', () => {
		const themeableRoles: readonly string[] = THEME_ICON_ROLES;
		for (const protectedRole of [
			'brand-mark',
			'provider',
			'editor-glyph',
			'error',
			'info',
			'warning',
			'success',
			'play',
			'pause'
		]) {
			expect(themeableRoles).not.toContain(protectedRole);
		}
	});
});
