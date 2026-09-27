import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import SubtitlePropertiesPanel from './subtitle-properties-panel.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
});

it('exposes the caption presets as a named group', async () => {
	const item: TimelineItem = {
		id: 'caption-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Captions',
		type: 'subtitle',
		text: 'Hello world'
	};
	timelineStore._setItems([item]);

	const screen = await render(SubtitlePropertiesPanel, {
		item,
		canvasWidth: 1920,
		canvasHeight: 1080,
		onedit: vi.fn()
	});

	const group = screen.getByRole('group', { name: m.video_editor_caption_presets() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_caption_preset_netflix() }))
		.toBeVisible();
});
