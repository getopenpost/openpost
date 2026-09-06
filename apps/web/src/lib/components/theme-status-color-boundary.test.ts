import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const semanticStatusSurfaces = [
	new URL('./composer-delivery-feedback.svelte', import.meta.url),
	new URL('./composer-validation-menu.svelte', import.meta.url),
	new URL('./inline-notice.svelte', import.meta.url),
	new URL('./media-acquisition-panel.svelte', import.meta.url),
	new URL('./panel-resize-handle.svelte', import.meta.url),
	new URL('./video-cover-frame-picker.svelte', import.meta.url),
	new URL('./workspace-activation-completion.svelte', import.meta.url),
	new URL('../../routes/quick-cut/+page.svelte', import.meta.url)
];

const fixedStatusColor =
	/(?:bg|border|fill|outline|ring|stroke|text)-(?:amber|blue|emerald|green|orange|red|yellow)(?:-\d{2,3})?(?:\/\d+)?|oklch\([^)]*\)|#[\dA-Fa-f]{3,8}\b/g;

describe('semantic status color boundary', () => {
	it('keeps app status chrome on resolved theme roles', async () => {
		for (const surface of semanticStatusSurfaces) {
			const source = await readFile(surface, 'utf8');
			expect(
				[...source.matchAll(fixedStatusColor)].map((match) => match[0]),
				surface.pathname
			).toEqual([]);
		}
	});

	it('exposes foreground roles for every semantic status background', async () => {
		const layout = await readFile(new URL('../../routes/layout.css', import.meta.url), 'utf8');

		for (const role of ['success', 'warning', 'info']) {
			expect(layout).toContain(`--color-${role}: var(--${role});`);
			expect(layout).toContain(`--color-${role}-foreground: var(--${role}-foreground);`);
		}
	});
});
