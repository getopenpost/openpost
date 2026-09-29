import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { resolveAnimatedItemLocalAt } from '../timeline/animated-properties';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import TextPropertiesPanel from './text-properties-panel.svelte';

function textItem(): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Launch title',
		type: 'text',
		text: 'Ship the work',
		fontFamily: 'Inter',
		fontSize: 64,
		fontWeight: 700,
		color: '#ffffff'
	};
}

afterEach(() => {
	timelineStore.__resetForTesting();
});

it('exposes the text style presets as a named group', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	const screen = await render(TextPropertiesPanel, { item, onedit: vi.fn() });

	await screen.getByRole('button', { name: m.video_editor_text_browse_styles() }).click();
	const group = screen.getByRole('group', { name: m.video_editor_text_templates() });
	await expect.element(group).toBeVisible();
});

it('exposes the text effects as a named group', async () => {
	const item = textItem();
	timelineStore._setItems([item]);
	const screen = await render(TextPropertiesPanel, { item, onedit: vi.fn() });

	await screen.getByRole('button', { name: m.video_editor_effects() }).click();
	const group = screen.getByRole('group', { name: m.video_editor_effects() });
	await expect.element(group).toBeVisible();
	await expect
		.element(group.getByRole('button', { name: m.video_editor_text_effect_shadow() }))
		.toBeVisible();
});

it('shows and edits animated font size at the playhead without changing the starting size', async () => {
	const item = { ...textItem(), keyframes: { fontSize: { frames: [0, 60], values: [64, 128] } } };
	timelineStore._setItems([item]);
	timelineStore._setCurrentFrame(30);
	commandHistory.clearHistory();
	const screen = await render(TextPropertiesPanel, { item, onedit: vi.fn() });
	const size = screen.getByRole('spinbutton', { name: 'Size', exact: true });
	await expect.element(size).toHaveValue(96);
	await size.fill('120');
	await userEvent.tab();
	expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 30).fontSize).toBe(120);
	expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 0).fontSize).toBe(64);
	commandHistory.undo();
	await expect.element(size).toHaveValue(96);
});
