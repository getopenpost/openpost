import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import BackgroundPanel from './background-panel.svelte';

it('exposes the background browser as a named group', async () => {
	const screen = await render(BackgroundPanel, { oninserted: vi.fn() });

	const group = screen.getByRole('group', { name: m.video_editor_backgrounds_title() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('searchbox', { name: m.video_editor_paper_search() }))
		.toBeVisible();
});
