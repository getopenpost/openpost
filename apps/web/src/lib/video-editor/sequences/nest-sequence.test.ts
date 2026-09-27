import { beforeEach, expect, it } from 'vitest';
import { createEmptyTimeline, createDefaultTracks } from '../project/defaults';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from './sequence-store.svelte';
import { nestSequence } from './sequence-actions';
import { commandHistory } from '../timeline/commands/command-store.svelte';
const tracks = createDefaultTracks();
beforeEach(() => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(
		{
			...createEmptyTimeline(),
			tracks,
			compositions: [
				{
					id: 'saved',
					name: 'Saved block',
					fps: 25,
					width: 1920,
					height: 1080,
					durationInFrames: 250,
					tracks,
					transitions: [],
					items: [
						{
							id: 'title',
							trackId: tracks[0]!.id,
							type: 'text',
							from: 0,
							durationInFrames: 250,
							label: 'Title'
						},
						{
							id: 'sound',
							trackId: tracks[2]!.id,
							type: 'audio',
							mediaId: 'sound',
							from: 0,
							durationInFrames: 250,
							label: 'Sound'
						}
					]
				}
			]
		},
		{ width: 1920, height: 1080, fps: 30 }
	);
});
it('inserts a ten-second block at another frame rate without moving existing footage and undoes once', () => {
	timelineStore._addItem({
		id: 'footage-audio',
		trackId: tracks[2]!.id,
		type: 'audio',
		from: 0,
		durationInFrames: 900,
		label: 'Footage',
		mediaId: 'footage'
	});
	const ids = nestSequence('saved', 30);
	const inserted = timelineStore.items.filter((item) => ids.includes(item.id));
	expect(inserted.map((item) => item.durationInFrames)).toEqual([300, 300]);
	expect(timelineStore.itemById.get('footage-audio')?.from).toBe(0);
	commandHistory.undo();
	expect(timelineStore.items.map((item) => item.id)).toEqual(['footage-audio']);
});
