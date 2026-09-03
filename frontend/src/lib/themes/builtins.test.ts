import { describe, expect, it } from 'vitest';
import {
	BUNDLED_THEME_FONT_FAMILIES,
	BUILT_IN_THEMES,
	THEME_COLOR_TOKEN_KEYS,
	THEME_COMPONENT_RECIPE_KEYS,
	THEME_MOTION_RECIPE_KEYS,
	THEME_PROTECTED_EDITOR_TOKEN_KEYS,
	THEME_TYPOGRAPHY_ROLE_KEYS,
	WORKSHOP_FALLBACK_THEME,
	getBuiltInTheme,
	isCompleteThemeSchemeManifest,
	resolveBuiltInTheme
} from './index.js';
import canonicalBuiltIns from '../../../../backend/internal/services/themes/builtins.v1.json';

const typographyTokenKeys = ['family', 'fallbacks', 'weight', 'size', 'lineHeight', 'tracking'];
const motionTokenKeys = ['duration', 'easing', 'distance', 'opacity'];

const expectedFamilies = [
	'workshop',
	'studio',
	'notebook',
	'playroom',
	'cloud-garden',
	'study-hall',
	'corkboard',
	'midnight',
	'ferrari',
	'apple',
	'todoist',
	'notion',
	'supabase',
	'vercel',
	'firecrawl',
	'linear',
	'calcom',
	'mintlify',
	'launchdarkly',
	'posthog',
	'origin',
	'column',
	'duolingo',
	'quizlet'
] as const;

const expectedDarkOnlyFamilies = [
	'midnight',
	'ferrari',
	'supabase',
	'linear',
	'launchdarkly',
	'origin'
] as const;

describe('built-in themes', () => {
	it('publishes the twenty-four versioned families with explicit scheme support', () => {
		expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(expectedFamilies);
		expect(getBuiltInTheme('workshop').supportedSchemes).toEqual(['light', 'dark']);
		for (const id of expectedFamilies.slice(1)) {
			const expected = (expectedDarkOnlyFamilies as readonly string[]).includes(id)
				? ['dark']
				: ['light'];
			expect(getBuiltInTheme(id).supportedSchemes).toEqual(expected);
		}

		for (const theme of BUILT_IN_THEMES) {
			expect(theme.schemaVersion).toBe(1);
			expect(theme.revision).toMatch(/^builtin-v\d+$/);
			for (const scheme of theme.supportedSchemes) {
				const manifest = theme.schemes[scheme]!;
				expect(isCompleteThemeSchemeManifest(manifest, scheme)).toBe(true);
				expect(Object.keys(manifest.colors).sort()).toEqual([...THEME_COLOR_TOKEN_KEYS].sort());
				expect(Object.keys(manifest.protectedEditor).sort()).toEqual(
					[...THEME_PROTECTED_EDITOR_TOKEN_KEYS].sort()
				);
				expect(Object.keys(manifest.typography).sort()).toEqual(
					[...THEME_TYPOGRAPHY_ROLE_KEYS].sort()
				);
				for (const role of THEME_TYPOGRAPHY_ROLE_KEYS) {
					expect(Object.keys(manifest.typography[role]).sort()).toEqual(
						[...typographyTokenKeys].sort()
					);
					expect(BUNDLED_THEME_FONT_FAMILIES).toContain(manifest.typography[role].family);
				}
				expect(Object.keys(manifest.motion).sort()).toEqual(
					[...THEME_MOTION_RECIPE_KEYS, 'reducedMotion'].sort()
				);
				for (const recipe of THEME_MOTION_RECIPE_KEYS) {
					expect(Object.keys(manifest.motion[recipe]).sort()).toEqual([...motionTokenKeys].sort());
				}
				expect(Object.keys(manifest.components).sort()).toEqual(
					[...THEME_COMPONENT_RECIPE_KEYS].sort()
				);
			}
		}
	});

	it('matches the canonical v1 fixture consumed by the Go service', () => {
		expect(BUILT_IN_THEMES).toEqual(canonicalBuiltIns);
	});

	it('gives every non-Workshop family a distinct structural identity', () => {
		const identities = BUILT_IN_THEMES.slice(1).map((theme) => {
			const manifest = theme.schemes.light ?? theme.schemes.dark!;
			return JSON.stringify({
				canvas: manifest.shell.canvasTreatment,
				decoration: manifest.components.decoration,
				button: manifest.components.button,
				navigation: manifest.components.navigation,
				card: manifest.components.card,
				tabs: manifest.components.tabs,
				toolbar: manifest.components.toolbar
			});
		});

		expect(new Set(identities).size).toBe(identities.length);
	});

	it('falls back to a complete Workshop scheme without mixing families', () => {
		const midnightInLight = resolveBuiltInTheme('midnight', 'light');
		const expected = WORKSHOP_FALLBACK_THEME.schemes.light!;

		expect(midnightInLight.source).toBe('fallback');
		expect(midnightInLight.id).toBe('workshop');
		expect(midnightInLight.fallbackReason).toBe('unsupported-scheme');
		expect(midnightInLight.manifest).toEqual(expected);
		expect(midnightInLight.manifest).not.toBe(expected);
	});
});
