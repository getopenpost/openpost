import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const semanticSurfaces = [
	new URL('../components/app-error-state.svelte', import.meta.url),
	new URL('../quick-cut/components/SegmentList.svelte', import.meta.url)
];

describe('remaining app icon boundary', () => {
	it('keeps functional app icons behind semantic registries', async () => {
		for (const surface of semanticSurfaces) {
			const source = await readFile(surface, 'utf8');
			expect(source, surface.pathname).not.toContain('@lucide/svelte');
		}
	});
});
