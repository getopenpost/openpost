import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { createDefaultTracks } from '../project/defaults';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import ClearKeyframesDialog from './clear-keyframes-dialog.svelte';

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const tracks = createDefaultTracks();
	timelineStore._setTracks(
		tracks.map((track) => (track.id === 'track-video-overlay' ? { ...track, locked: true } : track))
	);
	timelineStore._setItems([
		{
			id: 'editable',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'Editable',
			type: 'video',
			keyframes: {
				opacity: { frames: [0, 30], values: [0, 1] },
				rotation: { frames: [15], values: [20] }
			}
		},
		{
			id: 'locked',
			trackId: 'track-video-overlay',
			from: 0,
			durationInFrames: 60,
			label: 'Locked',
			type: 'video',
			keyframes: { opacity: { frames: [0], values: [1] } }
		}
	]);
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

describe('ClearKeyframesDialog', () => {
	it('shows exact scope and lock consequences, then clears as one edit', async () => {
		await page.viewport(320, 720);
		const oncleared = vi.fn();
		const screen = await render(ClearKeyframesDialog, {
			open: true,
			itemIds: ['editable', 'locked'],
			options: [
				{ value: 'opacity', label: 'Opacity', keyframeCount: 2 },
				{ value: 'rotation', label: 'Rotation', keyframeCount: 1 }
			],
			lockedItemCount: 1,
			oncleared
		});

		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByText('Keyframes to remove: 3.')).toBeVisible();
		await expect.element(screen.getByText(/Animated clips on locked tracks: 1/)).toBeVisible();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		await screen.getByRole('button', { name: 'Animation to clear' }).click();
		await screen.getByRole('option', { name: 'Opacity' }).click();
		await expect.element(screen.getByText('Keyframes to remove: 2.')).toBeVisible();
		const clearButton = screen.getByRole('button', { name: 'Clear 2' });
		expect(clearButton.element().offsetHeight).toBe(44);

		await clearButton.click();
		expect(oncleared).toHaveBeenCalledWith({
			changedItemIds: ['editable'],
			lockedItemIds: ['locked'],
			keyframesRemoved: 2
		});
		expect(timelineStore.itemById.get('editable')?.keyframes?.opacity).toBeUndefined();
		expect(timelineStore.itemById.get('editable')?.keyframes?.rotation?.frames).toEqual([15]);
		expect(timelineStore.itemById.get('locked')?.keyframes?.opacity?.frames).toEqual([0]);
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
