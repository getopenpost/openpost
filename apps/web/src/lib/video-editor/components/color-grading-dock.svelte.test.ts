import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
import ColorGradingDock from './color-grading-dock.svelte';

it('shows when a selected locked clip is excluded from grading', async () => {
	timelineStore.__resetForTesting();
	editorSettings.set('colorPalette', 'primaries');
	editorSettings.set('colorKeyframesVisible', false);
	const track = createDefaultTracks()[1]!;
	timelineStore._setTracks([
		{ ...track, id: 'editable', locked: false },
		{ ...track, id: 'locked', locked: true, order: 2 }
	]);
	timelineStore._setItems([
		{
			id: 'first',
			trackId: 'editable',
			type: 'image',
			label: 'First',
			from: 0,
			durationInFrames: 30
		},
		{
			id: 'second',
			trackId: 'locked',
			type: 'image',
			label: 'Second',
			from: 30,
			durationInFrames: 30
		}
	]);
	const screen = await render(ColorGradingDock, {
		itemId: 'first',
		itemIds: ['first', 'second'],
		sequenceName: 'Main',
		onedit: vi.fn()
	});

	await expect.element(screen.getByText('Editable: 1/2', { exact: true })).toBeVisible();
	await screen.rerender({ itemId: 'second', itemIds: ['second'] });
	await expect.element(screen.getByText('Clip: Second', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Editable: 0/1', { exact: true })).toBeVisible();
	await expect.element(screen.getByRole('slider', { name: 'Lift color wheel' })).toBeDisabled();
});
