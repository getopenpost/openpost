import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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
it('plots Flat and edited EQ as gain relative to the visible zero dB line', async () => {
	const item: TimelineItem = {
		id: 'audio',
		type: 'audio',
		trackId: 'track-audio',
		label: 'Audio',
		from: 0,
		durationInFrames: 240
	};
	timelineStore._setItems([item]);
	const screen = await render(AudioEqPanel, { item, open: true });
	const preset = screen.getByLabelText(m.video_editor_audio_eq_preset_aria());
	await preset.click();
	await screen.getByRole('option', { name: 'Flat', exact: true }).click();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	const graph = screen.getByRole('group', {
		name: m.video_editor_audio_eq_response(),
		exact: true
	});
	const handle = graph.getByRole('button', {
		name: `${m.video_editor_audio_eq_low_mid()} ${m.video_editor_audio_eq_response()}`,
		exact: true
	});
	const center = (element: Element) => {
		const rect = element.getBoundingClientRect();
		return rect.top + rect.height / 2;
	};
	const zero = graph.getByText('0', { exact: true });
	expect(Math.abs(center(handle.element()) - center(zero.element()))).toBeLessThan(2);
	await expect
		.element(graph.getByText(m.video_editor_audio_eq_gain(), { exact: true }))
		.toBeVisible();
	const curve = graph.element().querySelector('path')!;
	expect(Math.abs(center(curve) - center(zero.element()))).toBeLessThan(2);
	handle.element().focus();
	await userEvent.keyboard('{ArrowUp}');
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(0.5);
	expect(center(handle.element())).toBeLessThan(center(zero.element()));
	await expect.element(handle).toHaveFocus();
	commandHistory.undo();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	expect(Math.abs(center(handle.element()) - center(zero.element()))).toBeLessThan(2);
	commandHistory.redo();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	expect(center(handle.element())).toBeLessThan(center(zero.element()));
	await preset.click();
	await screen.getByRole('option', { name: 'Voice clarity', exact: true }).click();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(-2.5);
	const negativeTen = graph.getByText('-10', { exact: true });
	expect(
		(center(handle.element()) - center(zero.element())) /
			(center(negativeTen.element()) - center(zero.element()))
	).toBeCloseTo(0.25, 1);
	await screen.getByText(m.video_editor_audio_eq_low_mid(), { exact: true }).click();
	const band = screen
		.getByText(m.video_editor_audio_eq_low_mid(), { exact: true })
		.element()
		.closest('details')!;
	const gain = page
		.elementLocator(band)
		.getByRole('spinbutton', { name: m.video_editor_audio_eq_gain(), exact: true });
	await gain.fill('-6');
	await userEvent.keyboard('{Tab}');
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(-6);
	expect(
		(center(handle.element()) - center(zero.element())) /
			(center(negativeTen.element()) - center(zero.element()))
	).toBeCloseTo(0.6, 1);
	commandHistory.undo();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	await expect.element(gain).toHaveValue(-2.5);
	commandHistory.redo();
	await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
	await expect.element(gain).toHaveValue(-6);
});
