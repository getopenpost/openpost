import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import RepeatSelection from './repeat-selection.svelte';
import { createDefaultTracks } from '../project/defaults';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { transitionsStore } from '../timeline/actions/transitions.svelte';

it('applies the previewed batch and removes it with one undo', async () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.setAll([]);
	const tracks = createDefaultTracks();
	timelineStore.setAll({
		tracks,
		items: [
			{
				id: 'title',
				type: 'text',
				label: 'Title',
				trackId: tracks[0]!.id,
				from: 0,
				durationInFrames: 30
			}
		],
		currentFrame: 0,
		fps: 30
	});
	const oninserted = vi.fn();
	const screen = await render(RepeatSelection, {
		selectedIds: ['title'],
		oninserted
	});
	await screen.getByText('Repeat selection', { exact: true }).first().click();
	const preview = screen.getByRole('list', { name: m.video_editor_preview_suggestion() });
	await expect.element(preview).toBeVisible();
	const previewRows = preview.element().querySelectorAll('li');
	expect(previewRows).toHaveLength(2);
	expect([...previewRows].map((row) => row.querySelector('span')?.textContent?.trim())).toEqual([
		'Title',
		'Title'
	]);
	expect(
		[...previewRows].map((row) => row.querySelectorAll('span')[1]?.textContent?.trim())
	).toEqual(['00:00:01:00 · 00:00:02:00', '00:00:02:00 · 00:00:03:00']);
	await expect
		.element(
			screen.getByText(m.video_editor_repeat_preview({ count: '2', end: '3.0' }), {
				exact: true
			})
		)
		.toBeVisible();
	await screen.getByRole('button', { name: 'Repeat selection', exact: true }).click();
	expect(timelineStore.items.map((item) => item.from)).toEqual([0, 30, 60]);
	expect(oninserted).toHaveBeenCalledOnce();
	commandHistory.undo();
	expect(timelineStore.items.map((item) => item.id)).toEqual(['title']);
});
