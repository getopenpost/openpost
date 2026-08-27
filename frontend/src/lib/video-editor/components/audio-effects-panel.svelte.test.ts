import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { undo, redo } from '$lib/video-editor/timeline/commands/command-store.svelte';
import AudioEffectsPanel from './audio-effects-panel.svelte';
import '../../../routes/layout.css';

describe('AudioEffectsPanel rack', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
	});

	it('supports reorder, bypass, reset, and single-gesture undo', async () => {
		const item: TimelineItem = {
			id: 'clip-1',
			trackId: 'audio',
			from: 0,
			durationInFrames: 300,
			label: 'Music',
			type: 'audio',
			mediaId: 'media-1',
			audioEffects: [
				{
					id: 'fx-delay',
					type: 'delay',
					enabled: true,
					timeMs: 320,
					feedback: 0.32,
					mix: 0.28,
					lowCutHz: 180,
					highCutHz: 8000
				} as never,
				{
					id: 'fx-reverb',
					type: 'reverb',
					enabled: true,
					roomSize: 0.45,
					decaySeconds: 1.4,
					damping: 0.35,
					wet: 0.28,
					preDelayMs: 12
				} as never
			]
		};
		timelineStore.setAll({
			fps: 30,
			tracks: [
				{
					id: 'audio',
					name: 'Audio',
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

		const screen = await render(AudioEffectsPanel, {
			item: timelineStore.itemById.get('clip-1')!,
			open: true
		});

		// Bypass first effect
		await screen.getByRole('button', { name: 'Bypass Delay' }).click();
		expect(
			timelineStore.itemById.get('clip-1')?.audioEffects?.find((e) => e.id === 'fx-delay')?.enabled
		).toBe(false);

		// Reorder: move reverb up (↑)
		const upButtons = screen.getAllByRole('button', { name: '↑' });
		await upButtons[1]!.click();
		expect(timelineStore.itemById.get('clip-1')?.audioEffects?.[0]?.id).toBe('fx-reverb');

		// Reset reverb
		const resetButtons = screen.getAllByRole('button', { name: 'Reset Reverb' });
		await resetButtons[0]!.click();
		expect(timelineStore.itemById.get('clip-1')?.audioEffects?.[0]?.type).toBe('reverb');

		// Undo should revert reset as one gesture
		undo();
		expect(timelineStore.itemById.get('clip-1')?.audioEffects?.[0]?.id).toBe('fx-reverb');
		// Redo restores
		redo();
		expect(timelineStore.itemById.get('clip-1')?.audioEffects?.[0]?.type).toBe('reverb');

		// Reset all via Reset button
		await screen.getByRole('button', { name: 'Reset' }).click();
		expect(timelineStore.itemById.get('clip-1')?.audioEffects).toBeUndefined();

		undo();
		expect(timelineStore.itemById.get('clip-1')?.audioEffects).toHaveLength(2);

		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-audio-effects.png'
		});
	});
});
