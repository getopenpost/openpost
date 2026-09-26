import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import TransitionBrowserPanel from './transition-browser-panel.svelte';

it('exposes the transition browser as a named group', async () => {
	const screen = await render(TransitionBrowserPanel, { onapply: vi.fn() });

	const group = screen.getByRole('group', { name: m.video_editor_transition() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_transition_preset_fade() }))
		.toBeVisible();
});
