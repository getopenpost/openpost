import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import PropertyRuntimePanel from './property-runtime-panel.svelte';

it('exposes the expression dimensions strip as a named group', async () => {
	const item: TimelineItem = {
		id: 'clip-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: 'clip-1',
		type: 'image'
	};

	const screen = await render(PropertyRuntimePanel, {
		item,
		items: [item],
		availableProperties: ['x', 'y'],
		currentFrame: 0,
		fps: 30,
		onedit: vi.fn()
	});

	const group = screen.getByRole('group', {
		name: m.video_editor_expression_dimensions_title()
	});
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole('button').first()).toBeVisible();
});
