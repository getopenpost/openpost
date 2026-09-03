import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const semanticSurfaces = [
	new URL('../components/app-error-state.svelte', import.meta.url),
	new URL('../quick-cut/components/SegmentList.svelte', import.meta.url)
];

// Approved exceptions: public and pre-workspace screens are out of the theme
// scope by product decision (no workspace is known, so no theme applies), and
// may use library icons directly. Each entry records why the surface is exempt.
const approvedPublicExceptions: Array<{ file: URL; reason: string }> = [
	{
		file: new URL('../../routes/_components/PublicHome.svelte', import.meta.url),
		reason: 'pre-sign-in marketing surface, outside theme scope'
	},
	{
		file: new URL('../../routes/u/[username]/+page.svelte', import.meta.url),
		reason: 'public profile ledger, outside theme scope'
	}
];

describe('remaining app icon boundary', () => {
	it('keeps functional app icons behind semantic registries', async () => {
		for (const surface of semanticSurfaces) {
			const source = await readFile(surface, 'utf8');
			expect(source, surface.pathname).not.toContain('@lucide/svelte');
		}
	});

	it('documents every direct library icon use outside the theme scope', async () => {
		for (const { file } of approvedPublicExceptions) {
			const source = await readFile(file, 'utf8');
			expect(source, file.pathname).toContain('@lucide/svelte');
		}
	});
});
