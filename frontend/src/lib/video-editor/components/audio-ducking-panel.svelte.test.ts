/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening, anti-slop/no-conditional-empty-object-spread */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import AudioDuckingPanel from './audio-ducking-panel.svelte';
import '../../../routes/layout.css';

function makeItem(id = 'voice', trackId = 'track-a'): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 90,
		label: 'Voice',
		type: 'audio',
		mediaId: 'media-a'
	};
}

describe('AudioDuckingPanel', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore.setAll({
			fps: 30,
			tracks: [
				{
					id: 'track-a',
					name: 'Audio A',
					kind: 'audio',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				},
				{
					id: 'track-b',
					name: 'Audio B',
					kind: 'audio',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 1
				},
				{
					id: 'track-c',
					name: 'Video',
					kind: 'video',
					height: 72,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 2
				}
			],
			items: [makeItem()]
		});
	});

	it('enables, edits, scopes, meets 44px and no-overflow at 320 and 390, accessible, undo, persisted', async () => {
		const storeItem = timelineStore.itemById.get('voice')!;
		const screen = await render(AudioDuckingPanel, { item: storeItem, onedit: vi.fn() });

		// Title accessible via summary
		await expect.element(screen.getByText('Duck other audio')).toBeVisible();

		// 320 width no overflow
		await page.viewport(320, 844);
		screen.container.style.width = '300px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);

		// Open the details to reach the enable control
		await screen.getByText('Duck other audio').click();
		// Enable ducking via the toggle button (44px target)
		const enableBtn = screen.getByRole('button', { name: 'Enable ducking' });
		await expect.element(enableBtn).toBeVisible();
		expect(enableBtn.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		expect(enableBtn.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
		await enableBtn.click();
		expect(timelineStore.itemById.get('voice')?.audioDucking).toMatchObject({ duckOthersDb: -9 });

		// Accessible labels for amount, attack, release (and 44px inputs)
		const amountInput = screen.getByLabelText('Duck amount (dB)');
		await expect.element(amountInput).toBeVisible();
		expect(amountInput.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		const attackInput = screen.getByLabelText('Attack (s)');
		await expect.element(attackInput).toBeVisible();
		const releaseInput = screen.getByLabelText('Release (s)');
		await expect.element(releaseInput).toBeVisible();

		// Edit dB
		await amountInput.fill('-12');
		await amountInput.element().blur();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.duckOthersDb).toBe(-12);

		// Edit attack/release
		await attackInput.fill('0.15');
		await attackInput.element().blur();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.attackSec).toBeCloseTo(0.15);
		await releaseInput.fill('0.35');
		await releaseInput.element().blur();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.releaseSec).toBeCloseTo(0.35);

		// Scope target tracks via Checkbox (accessible, 44px label)
		await expect.element(screen.getByText('Only duck these tracks')).toBeVisible();
		const trackCheckbox = screen.getByRole('checkbox', { name: 'Audio B' });
		await expect.element(trackCheckbox).toBeVisible();
		const labelEl = trackCheckbox.element().closest('label');
		expect(labelEl).not.toBeNull();
		expect(labelEl!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

		await trackCheckbox.click();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.targetTrackIds).toEqual(['track-b']);
		// Uncheck
		await trackCheckbox.click();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.targetTrackIds).toBeUndefined();

		// One undo should revert last scoped edit
		commandHistory.undo();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.targetTrackIds).toEqual(['track-b']);
		commandHistory.redo();
		expect(timelineStore.itemById.get('voice')?.audioDucking?.targetTrackIds).toBeUndefined();

		// Persisted state still present after all edits
		expect(timelineStore.itemById.get('voice')?.audioDucking).toMatchObject({
			duckOthersDb: -12,
			attackSec: 0.15,
			releaseSec: 0.35
		});

		// No overflow at 320 already checked; also at 390
		await page.viewport(390, 844);
		screen.container.style.width = '370px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
		// Still 44px after resize
		expect(enableBtn.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		expect(amountInput.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
	});
});
