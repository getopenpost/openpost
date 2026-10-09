import { expect, it, onTestFinished, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import { m } from '$lib/paraglide/messages';
import EditorColorScopes from './editor-color-scopes.svelte';

import { ScopeRenderer } from '$lib/video-editor/effects/gpu-scopes';

it('offers named view-mode controls only when GPU scopes are available', async () => {
	const renderer = await ScopeRenderer.create();
	const create = vi.spyOn(ScopeRenderer, 'create').mockResolvedValue(renderer);
	onTestFinished(() => {
		create.mockRestore();
		renderer?.destroy();
	});
	onTestFinished(() => localStorage.removeItem('timeline:scopes:stackLayout'));
	localStorage.setItem('timeline:scopes:stackLayout', 'histogram');
	// A non-empty itemId is required: onMount returns before GPU setup when itemId is falsy.
	const screen = await render(EditorColorScopes, { itemId: 'clip-1' });

	const group = screen.getByRole('group', { name: m.video_editor_scope_live() });
	if (renderer) {
		await expect.element(group).toBeVisible();
		await expect.element(group.getByRole('button', { name: 'RGB' })).toBeVisible();
	} else {
		await expect.element(group).not.toBeInTheDocument();
		expect(screen.container.querySelector('[data-scope-backend="cpu"]')).not.toBeNull();
	}
});
