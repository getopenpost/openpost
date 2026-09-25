import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import LottieBrowserPanel from './lottie-browser-panel.svelte';

it('exposes the lottie browser as a named group', async () => {
	const screen = await render(LottieBrowserPanel, {
		projectId: 'project-1',
		oninserted: vi.fn(),
		fetchAnimations: () => new Promise<never>(() => {})
	});

	const group = screen.getByRole('group', { name: m.video_editor_lottiefiles() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('textbox', { name: m.video_editor_lottiefiles_search() }))
		.toBeVisible();
});
