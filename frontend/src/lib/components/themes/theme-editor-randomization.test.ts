import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '$lib/themes';

import {
	parseThemeManifest,
	randomizeThemeManifest,
	serializeThemeManifest
} from './theme-editor-model';

describe('theme editor color randomization', () => {
	it('produces a changed, complete manifest for every built-in scheme', () => {
		for (const source of BUILT_IN_THEMES) {
			for (const scheme of source.supportedSchemes) {
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
				}
			}
		}
	});
});
