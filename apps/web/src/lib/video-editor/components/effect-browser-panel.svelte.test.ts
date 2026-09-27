import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';
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

afterEach(() => timelineStore.__resetForTesting());

it('treats a double click as one effect insertion', async () => {
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'circle',
			label: 'circle',
			type: 'shape',
			shapeType: 'ellipse',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60
		}
	]);
	const onedit = vi.fn();
	const screen = await render(EffectBrowserPanel, {
		selectedItemIds: ['circle'],
		oninserted: vi.fn(),
		onedit
	});
	await userEvent.dblClick(screen.getByRole('button', { name: 'Invert', exact: true }));
	expect(timelineStore.items[0]?.effects).toHaveLength(1);
	expect(onedit).toHaveBeenCalledOnce();
});
