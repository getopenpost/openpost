import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '$lib/themes';

import {
	parseThemeManifest,
	randomizeThemeManifest,
	serializeThemeManifest
} from './theme-editor-model';

describe.each(BUILT_IN_THEMES)('theme editor color randomization: $id', (source) => {
	it.each(source.supportedSchemes)('produces a changed, complete %s manifest', (scheme) => {
		for (const seed of [0, 1, 2, 17, 42017, 2_147_483_647]) {
			const randomized = randomizeThemeManifest(source, scheme, seed, 'colors');
			expect(
				() => parseThemeManifest(serializeThemeManifest(randomized)),
				`${source.id} ${scheme} seed ${seed}`
			).not.toThrow();
			if (source.id === 'workshop') {
				expect(randomized.schemes[scheme]!.colors.actionFocal).not.toBe(
					source.schemes[scheme]!.colors.actionFocal
				);
			}
			const colors = randomized.schemes[scheme]!.colors;
			expect(
				new Set([colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5]).size,
				`${source.id} ${scheme} seed ${seed} chart palette`
			).toBe(5);
		}
	});
});
