import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import TextTemplateBrowser from './text-template-browser.svelte';

it('exposes the text template browser as a named group', async () => {
	const screen = await render(TextTemplateBrowser, { oninserted: vi.fn() });

	const group = screen.getByRole('group', { name: m.video_editor_text_templates() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_add_text(), exact: true }))
		.toBeVisible();
});
