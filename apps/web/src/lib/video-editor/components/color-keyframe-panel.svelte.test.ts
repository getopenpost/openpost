import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import ColorKeyframePanel from './color-keyframe-panel.svelte';

it('names the keyframe view tablist so assistive technology announces it', async () => {
	const screen = await render(ColorKeyframePanel, { itemId: null, onedit: vi.fn() });

	const tablist = screen.getByRole('tablist', { name: m.video_editor_keyframe_view() });
	await expect.element(tablist).toBeVisible();
	await expect
		.element(tablist.getByRole('tab', { name: m.video_editor_keyframe_view_dopesheet() }))
		.toBeVisible();
});
