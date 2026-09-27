import { expect, it } from 'vitest';
import { createDefaultTracks, createEmptyTimeline } from '../project/defaults';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { nestSequence } from './sequence-actions';
import { sequenceStore } from './sequence-store.svelte';
import { resizeReusableBlock, reusableBlockHold } from './reusable-block';
import type { TimelineItem } from '../project/types';

it('extends a rest block hold while retaining entrance, exit, sound length and other uses, with one undo', () => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	const tracks = createDefaultTracks();
	const items: TimelineItem[] = [
		{
			id: 'title',
			type: 'text',
			label: 'Title',
			trackId: tracks[0]!.id,
			from: 0,
			durationInFrames: 300,
			keyframes: {
				opacity: { frames: [0, 15, 285, 299], values: [0, 1, 1, 0] }
			}
		},
		{
			id: 'timer',
			type: 'text',
			label: 'Timer',
			trackId: tracks[1]!.id,
			from: 0,
			durationInFrames: 300,
			timer: { style: 'ring', direction: 'down', format: 'clock' }
		},
		{
			id: 'chime',
			type: 'audio',
			label: 'Chime',
			trackId: tracks[2]!.id,
			from: 285,
			durationInFrames: 15,
			mediaId: 'sound'
		}
	];
	sequenceStore.load(
		{
			...createEmptyTimeline(),
			tracks,
			compositions: [
				{
					id: 'block',
					name: 'Rest',
					fps: 30,
					width: 1920,
					height: 1080,
					durationInFrames: 300,
					tracks,
					items,
					transitions: [],
					reusableHold: reusableBlockHold(items, 300)
				}
			]
		},
		{ width: 1920, height: 1080, fps: 30 }
	);
	const first = nestSequence('block', 0);
	const second = nestSequence('block', 900);
	expect(resizeReusableBlock(first[0]!, 20)).toBe(true);
	const resized = sequenceStore.compositionById.get(
		timelineStore.itemById.get(first[0]!)!.compositionId!
	)!;
	expect(resized.items[0]!.keyframes?.opacity?.frames).toEqual([0, 15, 585, 599]);
	expect(resized.items[1]!.durationInFrames).toBe(600);
	expect(resized.items[2]).toMatchObject({ from: 585, durationInFrames: 15 });
	expect(first.map((id) => timelineStore.itemById.get(id)?.durationInFrames)).toEqual([600, 600]);
	expect(timelineStore.itemById.get(second[0]!)?.compositionId).toBe('block');
	commandHistory.undo();
	expect(first.map((id) => timelineStore.itemById.get(id)?.durationInFrames)).toEqual([300, 300]);
});
it('does not mistake a long animated entrance for a reusable hold', () => {
	const item: TimelineItem = {
		id: 'title',
		type: 'text',
		label: 'Title',
		trackId: 'track',
		from: 0,
		durationInFrames: 300,
		keyframes: { opacity: { frames: [0, 285, 299], values: [0, 1, 0] } }
	};
	expect(reusableBlockHold([item], 300)).toBeUndefined();
});
