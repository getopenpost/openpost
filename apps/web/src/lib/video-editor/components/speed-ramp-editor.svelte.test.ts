import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createDefaultTracks } from '../project/defaults';
import { setCurrentFrame } from '../timeline/actions/items';
import SpeedRampEditor from './speed-ramp-editor.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'clip',
			type: 'video',
			label: 'Own clip',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 240,
			sourceStart: 0,
			sourceEnd: 240,
			sourceFps: 30,
			speed: 1
		}
	]);
	commandHistory.clearHistory();
});
it('explains a speed point collision without authoring another point and recovers at another playhead position', async () => {
	const onedit = vi.fn();
	const screen = await render(SpeedRampEditor, { itemId: 'clip', itemIds: ['clip'], onedit });
	const add = screen.getByRole('button', { name: 'Add point', exact: true });
	add.element().focus();
	await userEvent.keyboard('{Enter}');
	expect(timelineStore.itemById.get('clip')!.speedRamp).toHaveLength(2);
	expect(commandHistory.undoStack).toHaveLength(1);
	await userEvent.keyboard('{Enter}');
	await expect
		.element(screen.getByRole('status'))
		.toHaveTextContent('A point already exists at the playhead. Move the playhead to add another.');
	expect(timelineStore.itemById.get('clip')!.speedRamp).toHaveLength(2);
	expect(commandHistory.undoStack).toHaveLength(1);
	expect(onedit).toHaveBeenCalledTimes(1);
	setCurrentFrame(30);
	await userEvent.keyboard('{Enter}');
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	expect(timelineStore.itemById.get('clip')!.speedRamp?.map((p) => p.sourceFrame)).toEqual([
		0, 30, 240
	]);
	expect(onedit).toHaveBeenCalledTimes(2);
	commandHistory.undo();
	expect(timelineStore.itemById.get('clip')!.speedRamp).toHaveLength(2);
	commandHistory.redo();
	expect(timelineStore.itemById.get('clip')!.speedRamp?.map((p) => p.sourceFrame)).toEqual([
		0, 30, 240
	]);
});
