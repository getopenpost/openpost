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
	resolveBuiltInTheme,
	themeColorContrastRatio
} from './index.js';
import canonicalBuiltIns from '../../../../backend/internal/services/themes/builtins.v1.json';

const typographyTokenKeys = ['family', 'fallbacks', 'weight', 'size', 'lineHeight', 'tracking'];
const motionTokenKeys = ['duration', 'easing', 'distance', 'opacity'];
const chartColorKeys = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'] as const;
const minimumChartChroma = 0.05;
const minimumChartColorDistance = 0.1;

function chartColorCoordinates(value: string) {
	const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
	if (!match) throw new Error(`Expected an OKLCH chart color, received ${value}`);
	const lightness = Number(match[1]);
	const chroma = Number(match[2]);
	const hue = Number(match[3]);
	const radians = (hue * Math.PI) / 180;
	return {
		lightness,
		chroma,
		a: chroma * Math.cos(radians),
		b: chroma * Math.sin(radians)
	};
}

function chartColorDistance(
	first: ReturnType<typeof chartColorCoordinates>,
	second: ReturnType<typeof chartColorCoordinates>
) {
	return Math.hypot(first.lightness - second.lightness, first.a - second.a, first.b - second.b);
}

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

const expectedDualSchemeFamilies = ['workshop', 'studio', 'playroom', 'cloud-garden'] as const;
const expectedDualSchemeFamilyIDs = new Set<string>(expectedDualSchemeFamilies);
const expectedDarkOnlyFamilyIDs = new Set<string>(expectedDarkOnlyFamilies);

describe('built-in themes', () => {
	it('publishes the twenty-four versioned families with explicit scheme support', () => {
		expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(expectedFamilies);
		for (const id of expectedDualSchemeFamilies) {
			expect(getBuiltInTheme(id).supportedSchemes).toEqual(['light', 'dark']);
		}
		for (const id of expectedFamilies.slice(1)) {
			if (expectedDualSchemeFamilyIDs.has(id)) continue;
			const expected = expectedDarkOnlyFamilyIDs.has(id) ? ['dark'] : ['light'];
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

	it('gives every built-in scheme five chromatic, distinguishable chart series', () => {
		for (const theme of BUILT_IN_THEMES) {
			for (const scheme of theme.supportedSchemes) {
				const colors = theme.schemes[scheme]!.colors;
				const chartColors = chartColorKeys.map((key) => ({
					key,
					...chartColorCoordinates(colors[key])
				}));

				for (const [index, color] of chartColors.entries()) {
					expect(
						color.chroma,
						`${theme.id} ${scheme} chart${index + 1} must remain a data color, not gray`
					).toBeGreaterThanOrEqual(minimumChartChroma);
					const chartColor = colors[color.key];
					for (const background of ['canvas', 'surface'] as const) {
						expect(
							themeColorContrastRatio(chartColor, colors[background], colors.canvas),
							`${theme.id} ${scheme} chart${index + 1} must remain visible against ${background}`
						).toBeGreaterThanOrEqual(3);
					}
				}
				for (const [index, color] of chartColors.entries()) {
					for (let otherIndex = index + 1; otherIndex < chartColors.length; otherIndex += 1) {
						expect(
							chartColorDistance(color, chartColors[otherIndex]!),
							`${theme.id} ${scheme} chart${index + 1} and chart${otherIndex + 1} must remain distinguishable`
						).toBeGreaterThanOrEqual(minimumChartColorDistance);
					}
				}
			}
		}
	});

	it('keeps protected editor surfaces visually aligned with the active scheme', () => {
		const lightEditor = resolveBuiltInTheme('workshop', 'light').manifest.protectedEditor;
		const darkEditor = resolveBuiltInTheme('workshop', 'dark').manifest.protectedEditor;
		const lightness = (color: string) =>
			Number(color.match(/^oklch\((?<value>[\d.]+)/)?.groups?.value);

		for (const surface of [
			lightEditor.editorCanvas,
			lightEditor.editorPanel,
			lightEditor.editorControl,
			lightEditor.timelineTrack,
			lightEditor.canvasPasteboard
		]) {
			expect(lightness(surface), surface).toBeGreaterThan(0.8);
		}
		expect(lightness(lightEditor.editorText)).toBeLessThan(0.35);
		expect(lightness(lightEditor.protectedGlyph)).toBeLessThan(0.35);

		for (const surface of [
			darkEditor.editorCanvas,
			darkEditor.editorPanel,
			darkEditor.editorControl,
			darkEditor.timelineTrack,
			darkEditor.canvasPasteboard
		]) {
			expect(lightness(surface), surface).toBeLessThan(0.35);
		}
		expect(lightness(darkEditor.editorText)).toBeGreaterThan(0.8);
		expect(lightness(darkEditor.protectedGlyph)).toBeGreaterThan(0.8);
	});

	it('uses pill actions for the reference families that specify them', () => {
		for (const id of ['apple', 'calcom', 'firecrawl', 'quizlet', 'supabase'] as const) {
			const theme = getBuiltInTheme(id);
			const scheme = theme.schemes.light ?? theme.schemes.dark!;
			expect(scheme.components.button, id).toBe('pill');
		}
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
