import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import ColorGradingDock from './color-grading-dock.svelte';
import '../../../routes/layout.css';

afterEach(async () => {
	await page.viewport(1280, 900);
});

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
	const compactAdd = addQualifier().element();
	const savePreset = screen.getByRole('button', { name: 'Save current effects as preset' });
	const bypass = screen.getByRole('button', { name: 'Disable all effects' });
	expect(compactAdd.className).toContain('[@media(pointer:coarse)]:h-11');
	await expect.element(savePreset).toBeVisible();
	expect(savePreset.element().className).toContain('[@media(pointer:coarse)]:size-11');
	await expect.element(bypass).toBeVisible();
	expect(bypass.element().className).toContain('[@media(pointer:coarse)]:size-11');

	await addQualifier().click();
	await vi.waitFor(() => expect(timelineStore.itemById.get('clip')?.effects).toHaveLength(2));
});

it('keeps a compact clip switcher available in short viewports', async () => {
	await page.viewport(640, 450);
	timelineStore.__resetForTesting();
	editorSession.clock.seek(0);
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
	const screen = await render(ColorGradingDock, {
		itemId: 'first',
		itemIds: ['first'],
		sequenceName: 'Main',
		onedit: vi.fn(),
		onselectitem
	});
	// A realistic short dock allocation; the switcher visibility itself comes from
	// the short viewport above, not from this host height.
	screen.container.style.cssText = 'display:flex;height:260px';

	const secondClip = screen.getByRole('button', {
		name: /Select a clip to use this tool\..*Second/u
	});
	await expect.element(secondClip).toBeVisible();
	const chip = secondClip.element();
	expect(chip.className).toContain('[@media(pointer:coarse)]:h-11');
	expect(chip.className).toContain('[@media(pointer:coarse)]:min-w-11');

	const rect = chip.getBoundingClientRect();
	// Pointer-fine chips are 24 px tall from the maintained Tailwind stylesheet.
	expect(rect.height).toBeGreaterThanOrEqual(24);
	expect(rect.top).toBeGreaterThanOrEqual(0);
	expect(rect.left).toBeGreaterThanOrEqual(0);
	expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
	expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
	const dock = chip.closest('section');
	if (!dock) throw new Error('Compact clip switcher is outside its dock section.');
	const dockRect = dock.getBoundingClientRect();
	expect(rect.top).toBeGreaterThanOrEqual(dockRect.top - 0.5);
	expect(rect.bottom).toBeLessThanOrEqual(dockRect.bottom + 0.5);
	expect(
		document
			.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
			?.closest('[data-color-clip-chip="second"]')
	).toBe(chip);

	await secondClip.click();
	expect(onselectitem).toHaveBeenCalledWith('second');
	expect(timelineStore.currentFrame).toBe(30);
	expect(editorSession.clock.currentFrame).toBe(30);
});
