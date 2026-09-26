import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ColorWorkspace from './color-workspace.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
});

it('exposes the color presets as a named group', async () => {
	const item: TimelineItem = {
		id: 'clip-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: 'clip-1',
		type: 'image'
	};
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([item]);

	const screen = await render(ColorWorkspace, { itemId: 'clip-1', onedit: vi.fn() });

	const group = screen.getByRole('group', { name: m.video_editor_color_presets() });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole('button').first()).toBeVisible();
});
