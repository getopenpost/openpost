import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { AudioEqSettings } from '$lib/video-editor/audio/types';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import AudioEqPanel from './audio-eq-panel.svelte';
import '../../../routes/layout.css';

describe('AudioEqPanel', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('edits a track or bus EQ value without requiring a timeline clip', async () => {
		await page.viewport(320, 844);
		const settings: AudioEqSettings = {
			enabled: true,
			lowEnabled: true,
			lowGainDb: 3,
			lowFrequencyHz: 120
		};
		const onsettingschange = vi.fn();
		const screen = await render(AudioEqPanel, {
			settings,
			onsettingschange,
			title: 'Track EQ'
		});
		screen.container.style.width = '300px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';

		await screen.getByText('Track EQ', { exact: true }).click();
		await screen.getByRole('button', { name: 'Bypass', exact: true }).click();
		expect(onsettingschange).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));

		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-track-audio-eq.png'
		});
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
	});

	it('keeps clip EQ edits on the existing timeline action path', async () => {
		const item: TimelineItem = {
			id: 'voice',
			trackId: 'audio',
			from: 0,
			durationInFrames: 90,
			label: 'Voice',
			type: 'audio',
			mediaId: 'voice-media',
			audioEqLowEnabled: true,
			audioEqLowGainDb: 3
		};
		timelineStore.setAll({
			fps: 30,
			tracks: [
				{
					id: 'audio',
					name: 'Audio 1',
					kind: 'audio',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [item]
		});
		const onedit = vi.fn();
		const screen = await render(AudioEqPanel, { item, onedit });

		await screen.getByText('Parametric EQ', { exact: true }).click();
		await screen.getByRole('button', { name: 'Bypass', exact: true }).click();

		expect(timelineStore.itemById.get(item.id)).toMatchObject({
			audioEqEnabled: false,
			audioEqLowEnabled: true,
			audioEqLowGainDb: 3
		});
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('applies one preset to a mixed clip selection and restores both originals with one undo', async () => {
		const first: TimelineItem = {
			id: 'voice-a',
			trackId: 'audio',
			from: 0,
			durationInFrames: 90,
			label: 'Voice A',
			type: 'audio',
			mediaId: 'voice-a-media',
			audioEqEnabled: true,
			audioEqLowGainDb: 2
		};
		const second: TimelineItem = {
			...first,
			id: 'voice-b',
			from: 100,
			label: 'Voice B',
			mediaId: 'voice-b-media',
			audioEqLowGainDb: -3
		};
		timelineStore.setAll({
			fps: 30,
			tracks: [
				{
					id: 'audio',
					name: 'Audio 1',
					kind: 'audio',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [first, second]
		});
		const onedit = vi.fn();
		const screen = await render(AudioEqPanel, { items: [first, second], onedit });

		await screen.getByText('Parametric EQ', { exact: true }).click();
		await expect.element(screen.getByText('Mixed', { exact: true }).first()).toBeVisible();
		await screen.getByRole('button', { name: 'EQ preset' }).click();
		await screen.getByRole('option', { name: 'Voice Clarity' }).click();

		expect(timelineStore.itemById.get(first.id)).toMatchObject({
			audioEqEnabled: true,
			audioEqLowGainDb: -1.5,
			audioEqHighMidGainDb: 4.5
		});
		expect(timelineStore.itemById.get(second.id)).toMatchObject({
			audioEqEnabled: true,
			audioEqLowGainDb: -1.5,
			audioEqHighMidGainDb: 4.5
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get(first.id)?.audioEqLowGainDb).toBe(2);
		expect(timelineStore.itemById.get(second.id)?.audioEqLowGainDb).toBe(-3);
	});

	it('edits an EQ band from the graph with one keyboard-accessible undo step', async () => {
		const item: TimelineItem = {
			id: 'voice',
			trackId: 'audio',
			from: 0,
			durationInFrames: 90,
			label: 'Voice',
			type: 'audio',
			mediaId: 'voice-media',
			audioEqEnabled: true,
			audioEqLowEnabled: true,
			audioEqLowFrequencyHz: 120,
			audioEqLowGainDb: 3
		};
		timelineStore.setAll({
			fps: 30,
			tracks: [
				{
					id: 'audio',
					name: 'Audio 1',
					kind: 'audio',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [item]
		});
		const screen = await render(AudioEqPanel, { item, open: true });
		const handle = screen.container.querySelector('[data-eq-band="low"]');
		if (!(handle instanceof HTMLButtonElement)) throw new Error('Low EQ handle did not render.');

		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

		expect(timelineStore.itemById.get(item.id)?.audioEqLowFrequencyHz).toBeGreaterThan(120);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get(item.id)?.audioEqLowFrequencyHz).toBe(120);
	});
});
