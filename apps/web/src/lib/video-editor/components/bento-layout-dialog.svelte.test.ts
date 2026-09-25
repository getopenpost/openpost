import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import BentoLayoutDialog from './bento-layout-dialog.svelte';

it('exposes the bento preset picker as a named group', async () => {
	const screen = await render(BentoLayoutDialog, { open: true, itemIds: [] });

	const group = screen.getByRole('group', { name: m.video_editor_bento_title() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_bento_auto() }))
		.toBeVisible();
});
