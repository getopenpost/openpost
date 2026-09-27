import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
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
	timelineStore._setTracks(tracks);
	timelineStore._setItems([
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			trackId: tracks[0]!.id,
			from: 0,
			durationInFrames: 30
		}
	]);
	const oninserted = vi.fn();
	const screen = await render(RepeatSelection, {
		selectedIds: ['title'],
		oninserted
	});
	await screen.getByText('Repeat selection', { exact: true }).first().click();
	await screen.getByRole('button', { name: 'Repeat selection', exact: true }).click();
	expect(timelineStore.items.map((item) => item.from)).toEqual([0, 30, 60]);
	expect(oninserted).toHaveBeenCalledOnce();
	commandHistory.undo();
	expect(timelineStore.items.map((item) => item.id)).toEqual(['title']);
});
