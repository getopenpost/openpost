import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, resolveBuiltInTheme } from '@openpost/ui/themes/builtins.js';
import {
	isSafeThemeColor,
	isSafeThemeSchemeManifestValues,
	themeColorContrastRatio
} from '@openpost/ui/themes/validation.js';

describe('theme manifest value validation', () => {
	it('ships lookbehind-free color detectors for pre-16.4 Safari engines', () => {
		// The installed @asamuzakjp/css-color is version-pinned and Bun-patched
		// (see patchedDependencies): its calc/var/relative-color detectors must
		// not use regex lookbehind, which Safari gained only in 16.4. If this
		// fails after a dependency upgrade, re-apply the three-detector patch.
		// SAFETY: require.resolve follows the package exports map to the real
		// installed location regardless of the node_modules layout.
		const require = createRequire(import.meta.url);
		const resolved = require.resolve('@asamuzakjp/css-color/package.json');
		const packageDir = dirname(resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved);
		const shipped = [
			'dist/esm/js/constant.js',
			'dist/cjs/index.cjs',
			'dist/browser/css-color.min.js'
		].map((relative) => readFileSync(join(packageDir, relative), 'utf8'));
		for (const source of shipped) {
			expect(source).not.toContain('(?<=');
			expect(source).toContain('(?:^|');
		}
	});

	it('keeps calc, var, and relative-color detection after the detector patch', async () => {
		// calc() and relative colors resolve end to end through theme validation;
		// an unresolvable var() stays unsafe by design, so its detector is
		// covered at the parser level instead.
		expect(isSafeThemeColor('rgb(calc(200 - 55) 0 0)')).toBe(true);
		expect(isSafeThemeColor('rgb(from red r g b)')).toBe(true);
		const { isColor } = await import('@asamuzakjp/css-color');
		expect(isColor('rgb(var(--channel) 0 0)')).toBe(true);
		expect(isSafeThemeColor('rgb(foo)')).toBe(false);
	});

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

	it('keeps Dither error text readable on raised surfaces in both schemes', () => {
		for (const scheme of ['light', 'dark'] as const) {
			const colors = resolveBuiltInTheme('dither', scheme).manifest.colors;
			expect(
				themeColorContrastRatio(colors.danger, colors.surfaceRaised, colors.canvas)
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('keeps inline error notices readable in base and saved Dither dark themes', () => {
		for (const [themeID, scheme] of [
			['workshop', 'light'],
			['dither', 'dark']
		] as const) {
			const colors = resolveBuiltInTheme(themeID, scheme).manifest.colors;
			expect(
				themeColorContrastRatio(
					colors.actionDestructiveInk,
					colors.actionDestructive,
					colors.canvas
				)
			).toBeGreaterThanOrEqual(4.5);
		}
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
