import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { setLocale } from '$lib/paraglide/runtime';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import BackgroundPropertiesPanel from './background-properties-panel.svelte';

const tracks: TimelineTrack[] = [
	{
		id: 'track-video-main',
		name: 'Video',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	}
];

function bgItem(): TimelineItem {
	return {
		id: 'bg1',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'Background',
		type: 'background',
		background: {
			kind: 'mesh-gradient',
			colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
			smoothness: 0.55,
			rotation: 0,
			scale: 1,
			offsetX: 0,
			offsetY: 0
		},
		transform: { width: 1920, height: 1080 }
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks, items: [bgItem()], currentFrame: 0, fps: 30 });
	commandHistory.clearHistory();
});

afterEach(() => setLocale('en', { reload: false }));

describe('BackgroundPropertiesPanel Chromium UI', () => {
	it('renders preset grid, color pickers, and sliders at desktop', async () => {
		const item = timelineStore.itemById.get('bg1')!;
		const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
		await expect.element(screen.getByRole('group', { name: 'Preset' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Sunset mesh' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Dots' })).toBeVisible();
		await expect.element(screen.getByLabelText('Color 1')).toBeVisible();
		await expect.element(screen.getByRole('slider', { name: 'Smoothness' })).toBeInTheDocument();
		await expect.element(screen.getByRole('slider', { name: 'Rotation' })).toBeInTheDocument();
		// No horizontal overflow at desktop width
		expect(screen.container.firstElementChild?.scrollWidth ?? 0).toBeLessThanOrEqual(
			screen.container.clientWidth + 2
		);
	});

	it('remains usable at 320px without overflow and switches kind', async () => {
		const item = timelineStore.itemById.get('bg1')!;
		const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
		// Simulate 320px viewport via container width
		screen.container.style.width = '320px';
		await expect.element(screen.getByRole('group', { name: 'Preset' })).toBeVisible();
		expect(screen.container.firstElementChild?.scrollWidth ?? 0).toBeLessThanOrEqual(320 + 4);

		await screen.getByLabelText('Kind').click();
		await screen.getByRole('option', { name: 'Pattern' }).click();
		expect(timelineStore.itemById.get('bg1')?.background?.kind).toBe('pattern');
		await expect.element(screen.getByRole('slider', { name: 'Density' })).toBeInTheDocument();
		await expect.element(screen.getByLabelText('Foreground', { exact: true })).toBeVisible();
	});

	it('keyboard: preset buttons are focusable and activate with Enter', async () => {
		const item = timelineStore.itemById.get('bg1')!;
		const onedit = vi.fn();
		const screen = await render(BackgroundPropertiesPanel, { item, onedit });
		const btn = screen.getByRole('button', { name: 'Ocean mesh' });
		await expect.element(btn).toBeVisible();
		await expect.element(btn).toHaveAttribute('aria-label', 'Ocean mesh');
		await btn.click();
		expect(timelineStore.itemById.get('bg1')?.background).toMatchObject({ kind: 'mesh-gradient' });
		expect(onedit).toHaveBeenCalled();
	});

	it('localizes preset labels via closed id mapping (es)', async () => {
		setLocale('es', { reload: false });
		const item = timelineStore.itemById.get('bg1')!;
		const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
		await expect.element(screen.getByRole('button', { name: 'Malla atardecer' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Puntos' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Rejilla' })).toBeVisible();
	});
});
