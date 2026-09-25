import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import EffectBrowserPanel from './effect-browser-panel.svelte';

it('exposes the effect browser as a named group', async () => {
	const screen = await render(EffectBrowserPanel, {
		selectedItemIds: [],
		oninserted: vi.fn(),
		onedit: vi.fn()
	});

	const group = screen.getByRole('group', { name: m.video_editor_effects() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('searchbox', { name: m.video_editor_effects_search() }))
		.toBeVisible();
});
