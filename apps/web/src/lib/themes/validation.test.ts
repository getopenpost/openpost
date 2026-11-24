import { describe, expect, it } from 'vitest';
import { resolveBuiltInTheme } from '@openpost/ui/themes/builtins.js';
import {
	isSafeThemeColor,
	isSafeThemeSchemeManifestValues,
	themeColorContrastRatio
} from '@openpost/ui/themes/validation.js';

describe('theme manifest value validation', () => {
	it('uses CSS Color syntax instead of accepting color-shaped strings', () => {
		expect(isSafeThemeColor('oklch(0.62 0.18 255 / 0.8)')).toBe(true);
		expect(
			isSafeThemeColor('color-mix(in oklch, oklch(0.62 0.18 255) 80%, oklch(0.2 0.01 255))')
		).toBe(true);
		expect(isSafeThemeColor('rgb(foo)')).toBe(false);
		expect(isSafeThemeColor('oklch(bad)')).toBe(false);
		expect(isSafeThemeColor('color-mix(in oklch, red)')).toBe(false);
	});

	it('enforces readable type and usable shell minima', () => {
		const tinyBody = resolveBuiltInTheme('workshop', 'light').manifest;
		tinyBody.typography.body.size = '0.5rem';
		expect(isSafeThemeSchemeManifestValues(tinyBody)).toBe(false);

		const shortHeader = resolveBuiltInTheme('workshop', 'light').manifest;
		shortHeader.shell.headerHeight = '2rem';
		expect(isSafeThemeSchemeManifestValues(shortHeader)).toBe(false);
	});

	it('keeps semantic text pairs readable and status colors distinct', () => {
		const unreadableSelection = resolveBuiltInTheme('workshop', 'light').manifest;
		unreadableSelection.colors.selectionInk = unreadableSelection.colors.selection;
		expect(isSafeThemeSchemeManifestValues(unreadableSelection)).toBe(false);

		const indistinguishableStatus = resolveBuiltInTheme('workshop', 'light').manifest;
		indistinguishableStatus.colors.info = indistinguishableStatus.colors.success;
		expect(isSafeThemeSchemeManifestValues(indistinguishableStatus)).toBe(false);
	});

	it('rejects unreadable focal, destructive and link hover text independently', () => {
		const control = resolveBuiltInTheme('workshop', 'light').manifest;
		expect(isSafeThemeSchemeManifestValues(control), 'original palette control').toBe(true);
		for (const [background, ink] of [
			['actionFocalHover', 'actionFocalInk'],
			['actionDestructiveHover', 'actionDestructiveInk'],
			['canvas', 'actionLinkHover']
		] as const) {
			const unreadable = structuredClone(control);
			if (ink === 'actionLinkHover') unreadable.colors[ink] = unreadable.colors[background];
			else unreadable.colors[background] = unreadable.colors[ink];
			expect(
				themeColorContrastRatio(unreadable.colors[ink], unreadable.colors[background]),
				`${background} contrast control`
			).toBeCloseTo(1);
			expect(
				isSafeThemeSchemeManifestValues(unreadable),
				`${background}/${ink} unreadable hover`
			).toBe(false);
		}
	});

	it('keeps focus visible and destructive actions semantically distinct', () => {
		const invisibleFocus = resolveBuiltInTheme('workshop', 'light').manifest;
		invisibleFocus.colors.focus = invisibleFocus.colors.canvas;
		expect(isSafeThemeSchemeManifestValues(invisibleFocus)).toBe(false);

		const unsafeDestructive = resolveBuiltInTheme('workshop', 'light').manifest;
		unsafeDestructive.colors.actionDestructive = unsafeDestructive.colors.actionPrimary;
		unsafeDestructive.colors.actionDestructiveHover = unsafeDestructive.colors.actionPrimaryHover;
		unsafeDestructive.colors.actionDestructiveActive = unsafeDestructive.colors.actionPrimaryActive;
		unsafeDestructive.colors.actionDestructiveInk = unsafeDestructive.colors.actionPrimaryInk;
		expect(isSafeThemeSchemeManifestValues(unsafeDestructive)).toBe(false);
	});

	it('rejects a custom Dither button recipe when its texture makes the label unreadable', () => {
		const manifest = resolveBuiltInTheme('workshop', 'light').manifest;
		expect(isSafeThemeSchemeManifestValues(manifest)).toBe(true);
		manifest.components.button = 'dither';
		expect(isSafeThemeSchemeManifestValues(manifest)).toBe(false);
	});

	it('rejects a readable custom palette whose dither cells have indistinguishable luminance', () => {
		const manifest = resolveBuiltInTheme('dither', 'light').manifest;
		Object.assign(manifest.colors, {
			actionFocal: '#7309cb',
			actionFocalHover: '#6b08b5',
			actionFocalActive: '#6007a5',
			actionFocalInk: '#6bdd0a'
		});
		manifest.components.button = 'solid';
		expect(isSafeThemeSchemeManifestValues(manifest)).toBe(true);
		manifest.components.button = 'dither';
		expect(isSafeThemeSchemeManifestValues(manifest)).toBe(false);
	});
});
