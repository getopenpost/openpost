import { describe, expect, it } from 'vitest';
import {
	BUILT_IN_THEMES,
	WORKSHOP_FALLBACK_THEME,
	getBuiltInTheme,
	resolveBuiltInTheme,
	themeColorContrastRatio
} from '@openpost/ui/themes/index.js';
import canonicalBuiltIns from '../../../../server/internal/services/themes/builtins.v1.json';

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

describe('built-in themes', () => {
	it('keeps Dither action text readable through the strongest texture tier', () => {
		for (const id of ['dither', 'dither-moss'] as const) {
			for (const scheme of ['light', 'dark'] as const) {
				const colors = getBuiltInTheme(id).schemes[scheme]!.colors;
				for (const intent of ['actionFocal', 'actionPrimary', 'actionOrdinary'] as const) {
					const ink = colors[`${intent}Ink`];
					for (const state of [intent, `${intent}Hover`, `${intent}Active`] as const) {
						const textured = `color-mix(in srgb, ${ink} 16%, ${colors[state]})`;
						expect(
							themeColorContrastRatio(ink, textured),
							`${id} ${scheme} ${state}`
						).toBeGreaterThanOrEqual(4.5);
						const textureContrast = themeColorContrastRatio(colors[state], textured)!;
						expect(textureContrast, `${id} ${scheme} ${state}`).toBeGreaterThanOrEqual(1.18);
						expect(textureContrast, `${id} ${scheme} ${state}`).toBeLessThanOrEqual(1.8);
					}
				}
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
