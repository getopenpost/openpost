import { describe, expect, it } from 'vitest';
import { getBuiltInTheme, isCompleteThemeSchemeManifest } from '$lib/themes';
import { updateDitherAccent } from './theme-editor-accent';

describe('Dither accent', () => {
	it.each(['dither', 'dither-moss'] as const)(
		'keeps %s readable across the hue wheel in both schemes',
		(id) => {
			const original = getBuiltInTheme(id);
			for (let hue = 0; hue < 360; hue += 15) {
				const changed = updateDitherAccent(original, hue);
				for (const scheme of ['light', 'dark'] as const) {
					expect(
						isCompleteThemeSchemeManifest(changed.schemes[scheme]),
						`${scheme} hue ${hue}`
					).toBe(true);
					for (const key of [
						'canvas',
						'ink',
						'danger',
						'success',
						'chart1',
						'chart2',
						'chart3',
						'chart4',
						'chart5'
					] as const) {
						expect(changed.schemes[scheme]!.colors[key]).toBe(
							original.schemes[scheme]!.colors[key]
						);
					}
				}
			}
		}
	);
});
