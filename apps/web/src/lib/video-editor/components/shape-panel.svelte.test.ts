import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import ShapePanel from './shape-panel.svelte';

it('exposes the shape browser as a named group', async () => {
	const screen = await render(ShapePanel, { oninserted: vi.fn() });

	const group = screen.getByRole('group', { name: m.video_editor_shapes() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_shape_fill_solid() }))
		.toBeVisible();
});
