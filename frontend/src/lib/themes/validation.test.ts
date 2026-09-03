import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, resolveBuiltInTheme } from './builtins.js';
import {
	isSafeThemeColor,
	isSafeThemeSchemeManifestValues,
	themeColorContrastRatio
} from './validation.js';

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

	it('rejects malformed lengths, easing curves, and shadows', () => {
		const malformedLength = resolveBuiltInTheme('workshop', 'light').manifest;
		malformedLength.typography.display.size = 'clamp(1rem, 2rem)';
		expect(isSafeThemeSchemeManifestValues(malformedLength)).toBe(false);

		const malformedEasing = resolveBuiltInTheme('workshop', 'light').manifest;
		malformedEasing.motion.hover.easing = 'cubic-bezier(2, 0, 3, 1)';
		expect(isSafeThemeSchemeManifestValues(malformedEasing)).toBe(false);

		const malformedShadow = resolveBuiltInTheme('workshop', 'light').manifest;
		malformedShadow.elevation.card = '0 8px nonsense';
		expect(isSafeThemeSchemeManifestValues(malformedShadow)).toBe(false);
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

	it('rejects unreadable action text in every rendered interaction state', () => {
		const unreadableHover = resolveBuiltInTheme('workshop', 'light').manifest;
		unreadableHover.colors.actionFocal = '#000000';
		unreadableHover.colors.actionFocalHover = '#888888';
		unreadableHover.colors.actionFocalActive = '#222222';
		unreadableHover.colors.actionFocalInk = '#ffffff';
		expect(isSafeThemeSchemeManifestValues(unreadableHover)).toBe(false);

		const unreadableDestructive = resolveBuiltInTheme('workshop', 'light').manifest;
		unreadableDestructive.colors.actionDestructive = '#888888';
		unreadableDestructive.colors.actionDestructiveHover = '#777777';
		unreadableDestructive.colors.actionDestructiveActive = '#666666';
		unreadableDestructive.colors.actionDestructiveInk = '#ffffff';
		expect(isSafeThemeSchemeManifestValues(unreadableDestructive)).toBe(false);

		const unreadableLinkHover = resolveBuiltInTheme('workshop', 'light').manifest;
		unreadableLinkHover.colors.actionLinkHover = unreadableLinkHover.colors.canvas;
		expect(isSafeThemeSchemeManifestValues(unreadableLinkHover)).toBe(false);
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

	it('measures WCAG contrast after alpha compositing', () => {
		expect(themeColorContrastRatio('black', 'white')).toBe(21);
		expect(themeColorContrastRatio('rgb(0 0 0 / 50%)', 'white')).toBeCloseTo(3.98, 2);
	});

	it('keeps every built-in scheme inside the same safety floor', () => {
		for (const theme of BUILT_IN_THEMES) {
			for (const manifest of Object.values(theme.schemes)) {
				if (manifest) expect(isSafeThemeSchemeManifestValues(manifest), theme.id).toBe(true);
			}
		}

		const corkboard = resolveBuiltInTheme('corkboard', 'light').manifest.colors;
		expect(
			themeColorContrastRatio(corkboard.disabledInk, corkboard.disabled, corkboard.canvas)
		).toBeGreaterThanOrEqual(4.5);
	});
});
