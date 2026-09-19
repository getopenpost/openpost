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

it('keeps dedicated effect actions after adding the first qualifier', async () => {
	timelineStore.__resetForTesting();
	editorSettings.set('colorPalette', 'qualifier');
	editorSettings.set('colorKeyframesVisible', false);
	const track = createDefaultTracks()[1]!;
	timelineStore._setTracks([{ ...track, id: 'editable', locked: false }]);
	timelineStore._setItems([
		{
			id: 'clip',
			trackId: 'editable',
			type: 'image',
			label: 'Clip',
			from: 0,
			durationInFrames: 30
		}
	]);
	const screen = await render(ColorGradingDock, {
		itemId: 'clip',
		itemIds: ['clip'],
		sequenceName: 'Main',
		onedit: vi.fn()
	});
	const addQualifier = () =>
		screen.getByRole('button', { name: 'Add effect · Secondary Qualifier' });

	await addQualifier().click();
	await vi.waitFor(() => expect(timelineStore.itemById.get('clip')?.effects).toHaveLength(1));
	await expect.element(addQualifier()).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Save current effects as preset' }))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Disable all effects' })).toBeVisible();

	await addQualifier().click();
	await vi.waitFor(() => expect(timelineStore.itemById.get('clip')?.effects).toHaveLength(2));
});

it('keeps a compact clip switcher available in short viewports', async () => {
	timelineStore.__resetForTesting();
	editorSettings.set('colorPalette', 'primaries');
	editorSettings.set('colorKeyframesVisible', false);
	const track = createDefaultTracks()[1]!;
	timelineStore._setTracks([{ ...track, id: 'editable', locked: false }]);
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
			trackId: 'editable',
			type: 'image',
			label: 'Second',
			from: 30,
			durationInFrames: 30
		}
	]);
	const onselectitem = vi.fn();
	await render(ColorGradingDock, {
		itemId: 'first',
		itemIds: ['first'],
		sequenceName: 'Main',
		onedit: vi.fn(),
		onselectitem
	});
	const secondClip = document.querySelector('[data-color-clip-chip="second"]');
	if (!(secondClip instanceof HTMLButtonElement)) throw new Error('Expected compact clip button');

	secondClip.click();
	expect(onselectitem).toHaveBeenCalledWith('second');
});
