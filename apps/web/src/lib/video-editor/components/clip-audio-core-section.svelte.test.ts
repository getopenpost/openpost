import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import ClipAudioCoreSection from './clip-audio-core-section.svelte';

function audio(id: string, durationInFrames: number): TimelineItem {
	return {
		id,
		type: 'audio',
		trackId: 'track-audio',
		label: id,
		from: 0,
		durationInFrames,
		speed: 2
	};
}

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('authors both fades up to the timeline duration with undo and redo', async () => {
	const item = audio('long', 240);
	timelineStore._setItems([item]);
	commandHistory.clearHistory();
	const onedit = vi.fn();
	const screen = await render(ClipAudioCoreSection, { audioItems: [item], onedit });
	for (const label of [
		m.video_editor_clip_fade_in_seconds(),
		m.video_editor_clip_fade_out_seconds()
	]) {
		await expect
			.element(screen.getByRole('slider', { name: label }))
			.toHaveAttribute('aria-valuemax', '8');
		const input = screen.getByRole('textbox', { name: label });
		await input.fill('7');
		await userEvent.keyboard('{Tab}');
		await screen.rerender({ audioItems: [timelineStore.itemById.get(item.id)!] });
		await expect.element(input).toHaveValue('7.00');
	}
	expect(timelineStore.itemById.get(item.id)).toMatchObject({
		audioFadeIn: 7,
		audioFadeOut: 7,
		durationInFrames: 240,
		speed: 2
	});
	expect(onedit).toHaveBeenCalledTimes(2);
	commandHistory.undo();
	expect(timelineStore.itemById.get(item.id)?.audioFadeOut ?? 0).toBe(0);
	expect(timelineStore.itemById.get(item.id)?.audioFadeIn).toBe(7);
	commandHistory.redo();
	expect(timelineStore.itemById.get(item.id)?.audioFadeOut).toBe(7);
});

it('uses the shortest selected timeline clip as the common fade bound', async () => {
	const items = [audio('long', 240), audio('short', 90)];
	timelineStore._setItems(items);
	commandHistory.clearHistory();
	const screen = await render(ClipAudioCoreSection, { audioItems: items, onedit: vi.fn() });
	const label = m.video_editor_clip_fade_in_seconds();
	await expect
		.element(screen.getByRole('slider', { name: label }))
		.toHaveAttribute('aria-valuemax', '3');
	await screen.getByRole('textbox', { name: label }).fill('7');
	await userEvent.keyboard('{Tab}');
	expect(timelineStore.items.map((item) => item.audioFadeIn)).toEqual([3, 3]);
	commandHistory.undo();
	expect(timelineStore.items.map((item) => item.audioFadeIn ?? 0)).toEqual([0, 0]);
});
