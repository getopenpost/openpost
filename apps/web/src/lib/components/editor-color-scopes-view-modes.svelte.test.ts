import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import { m } from '$lib/paraglide/messages';
import EditorColorScopes from './editor-color-scopes.svelte';

it('exposes the scope view-mode switcher as a named group', async () => {
	localStorage.setItem('timeline:scopes:stackLayout', 'histogram');
	// A non-empty itemId is required: onMount returns before GPU setup when itemId is falsy.
	const screen = await render(EditorColorScopes, { itemId: 'clip-1' });

	const group = screen.getByRole('group', { name: m.video_editor_scope_live() });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole('button', { name: 'RGB' })).toBeVisible();
});
