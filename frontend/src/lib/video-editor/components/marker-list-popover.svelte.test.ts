import { beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { selectMarker } from '$lib/video-editor/timeline/actions/items';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import MarkerListPopover from './marker-list-popover.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		fps: 30,
		currentFrame: 0,
		tracks: [],
		items: [],
		markers: [
			{ id: 'outro', frame: 60, label: 'Outro', color: '#22c55e' },
			{ id: 'intro', frame: 10, label: 'Intro', color: '#f97316' },
			{ id: 'beat', frame: 30, label: 'Beat', color: '#38bdf8' }
		]
	});
});

it('seeks, removes, and clears markers from the sorted 320px list', async () => {
	await page.viewport(320, 640);
	const onedit = vi.fn();
	const screen = await render(MarkerListPopover, {
		onselect: (marker) => selectMarker(marker.id),
		onedit
	});
	screen.container.style.width = '320px';
	screen.container.style.padding = '16px';

	await screen.getByRole('button', { name: 'Markers (3)' }).click();
	await expect.element(screen.getByText('00:00:00:10')).toBeVisible();
	await expect.element(screen.getByText('00:00:01:00')).toBeVisible();
	await expect.element(screen.getByText('00:00:02:00')).toBeVisible();
	await page.screenshot({
		path: '../../../../.svelte-kit/openpost-marker-list-phone.png'
	});

	await screen.getByRole('button', { name: /Intro.*00:00:00:10/ }).click();
	expect(timelineStore.selectedMarkerId).toBe('intro');
	expect(timelineStore.currentFrame).toBe(10);

	await screen.getByRole('button', { name: 'Markers (3)' }).click();
	await screen.getByRole('button', { name: 'Remove Outro' }).click();
	expect(timelineStore.markers.map((marker) => marker.id)).toEqual(['intro', 'beat']);
	expect(onedit).toHaveBeenCalledTimes(1);

	await screen.getByRole('button', { name: 'Clear all markers' }).click();
	expect(timelineStore.markers).toEqual([]);
	expect(onedit).toHaveBeenCalledTimes(2);
	commandHistory.undo();
	expect(timelineStore.markers.map((marker) => marker.id)).toEqual(['intro', 'beat']);
});
