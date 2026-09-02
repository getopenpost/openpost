import { describe, expect, it, vi } from 'vitest';
import { THEME_ICON_PACK_IDS, THEME_ICON_ROLES } from '../contracts.js';
import lucidePack from './packs/lucide.generated.js';
import { createThemeIconRegistry, getThemeIcon, loadThemeIconPack } from './registry.js';
import type { ThemeIconPack } from './types.js';

function packFor(id: ThemeIconPack['id']): ThemeIconPack {
	return { id, icons: structuredClone(lucidePack.icons) };
}

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
		const recoveredPack = packFor('tabler');
		const recovered = vi.fn(async () => ({ default: recoveredPack }));
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
		await expect(registry.loadPack('tabler')).resolves.toEqual(recoveredPack);
		expect(failed).toHaveBeenCalledOnce();
		expect(recovered).toHaveBeenCalledOnce();
	});

	it('rejects an incomplete pack atomically and permits a complete retry', async () => {
		const incomplete = packFor('tabler');
		Reflect.deleteProperty(incomplete.icons, 'settings');
		const complete = packFor('tabler');
		let candidate = incomplete;
		const registry = createThemeIconRegistry({
			lucide: async () => ({ default: lucidePack }),
			'heroicons-outline': async () => ({ default: packFor('heroicons-outline') }),
			'heroicons-solid': async () => ({ default: packFor('heroicons-solid') }),
			phosphor: async () => ({ default: packFor('phosphor') }),
			tabler: async () => ({ default: candidate })
		});

		await expect(registry.loadPack('tabler')).rejects.toThrow('invalid settings');
		expect(registry.getIcon('tabler', 'add')).toEqual(lucidePack.icons.add);

		candidate = complete;
		await expect(registry.loadPack('tabler')).resolves.toEqual(complete);
		expect(registry.getIcon('tabler', 'add')).toEqual(complete.icons.add);
	});

	it('rejects packs with the wrong identity or unsafe SVG bodies', async () => {
		const unsafe = packFor('phosphor');
		unsafe.icons.settings.body = '<script>alert(1)</script>';
		const registry = createThemeIconRegistry({
			lucide: async () => ({ default: lucidePack }),
			'heroicons-outline': async () => ({ default: packFor('heroicons-outline') }),
			'heroicons-solid': async () => ({ default: packFor('heroicons-solid') }),
			phosphor: async () => ({ default: unsafe }),
			tabler: async () => ({ default: lucidePack })
		});

		await expect(registry.loadPack('phosphor')).rejects.toThrow('invalid settings');
		await expect(registry.loadPack('tabler')).rejects.toThrow('wrong theme icon pack');
	});
});
