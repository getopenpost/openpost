import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import StickerBrowserPanel from './sticker-browser-panel.svelte';

it('exposes the sticker browser as a named group', async () => {
	const screen = await render(StickerBrowserPanel, {
		projectId: 'project-1',
		oninserted: vi.fn(),
		loadCatalog: () => new Promise<never>(() => {})
	});

	const group = screen.getByRole('group', { name: m.video_editor_stickers() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('textbox', { name: m.video_editor_stickers_search() }))
		.toBeVisible();
});
