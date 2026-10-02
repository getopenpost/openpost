import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import AudioEqPanel from './audio-eq-panel.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('preserves a user-closed bus EQ when its settings refresh', async () => {
	const screen = await render(AudioEqPanel, { open: true, settings: {} });
	const preset = screen.getByLabelText(m.video_editor_audio_eq_preset_aria());
	await expect.element(preset).toBeVisible();
	await screen.getByText(m.video_editor_audio_eq_title(), { exact: true }).click();
	await expect.element(preset).not.toBeVisible();
	await screen.rerender({ settings: { outputGainDb: 1 } });
	await expect.element(preset).not.toBeVisible();
});

it('keeps the user-opened EQ and keyboard focus through preset edits and undo', async () => {
	const item: TimelineItem = {
		id: 'audio',
		type: 'audio',
		trackId: 'track-audio',
		label: 'Audio',
		from: 0,
		durationInFrames: 240,
		speed: 2
	};
	timelineStore._setItems([item]);
	commandHistory.clearHistory();
	const screen = await render(AudioEqPanel, { item, onedit: vi.fn() });
	await screen.getByText(m.video_editor_audio_eq_title(), { exact: true }).click();
	const preset = screen.getByLabelText(m.video_editor_audio_eq_preset_aria());
	await preset.click();
	await screen
		.getByRole('option', { name: m.video_editor_audio_eq_preset_voice_clarity(), exact: true })
		.click();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	await expect.element(preset).toBeVisible();

	const handle = screen.getByRole('button', {
		name: `${m.video_editor_audio_eq_low_mid()} ${m.video_editor_audio_eq_response()}`,
		exact: true
	});
	const previousGain = timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb ?? 0;
	handle.element().focus();
	await userEvent.keyboard('{ArrowUp}');
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	await expect.element(handle).toBeVisible();
	await expect.element(handle).toHaveFocus();
	expect(timelineStore.itemById.get(item.id)).toMatchObject({
		audioEqLowMidGainDb: previousGain + 0.5,
		durationInFrames: 240,
		speed: 2
	});
	commandHistory.undo();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	await expect.element(handle).toBeVisible();
	expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(previousGain);
});
