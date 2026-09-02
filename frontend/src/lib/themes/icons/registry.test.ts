import { describe, expect, it, vi } from 'vitest';
import { THEME_ICON_PACK_IDS, THEME_ICON_ROLES } from '../contracts.js';
import lucidePack from './packs/lucide.generated.js';
import { createThemeIconRegistry, getThemeIcon, loadThemeIconPack } from './registry.js';

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

	it('always exposes the embedded Workshop icon synchronously', () => {
		const registry = createThemeIconRegistry({
			lucide: async () => ({ default: lucidePack }),
			'heroicons-outline': async () => ({ default: lucidePack }),
			'heroicons-solid': async () => ({ default: lucidePack }),
			phosphor: async () => ({ default: lucidePack }),
			tabler: async () => ({ default: lucidePack })
		});

		expect(registry.getIcon('tabler', 'settings')).toEqual(lucidePack.icons.settings);
		expect(getThemeIcon('lucide', 'settings')).toEqual(lucidePack.icons.settings);
	});

	it('drops a rejected pack request so a later activation can retry', async () => {
		const failed = vi.fn(() => Promise.reject(new Error('chunk unavailable')));
		const recovered = vi.fn(async () => ({ default: lucidePack }));
		let loader = failed;
		const registry = createThemeIconRegistry({
			lucide: async () => ({ default: lucidePack }),
			'heroicons-outline': async () => ({ default: lucidePack }),
			'heroicons-solid': async () => ({ default: lucidePack }),
			phosphor: async () => ({ default: lucidePack }),
			tabler: () => loader()
		});

		await expect(registry.loadPack('tabler')).rejects.toThrow('chunk unavailable');
		loader = recovered;
		await expect(registry.loadPack('tabler')).resolves.toEqual(lucidePack);
		expect(failed).toHaveBeenCalledOnce();
		expect(recovered).toHaveBeenCalledOnce();
	});
});
