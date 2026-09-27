import { expect, it } from 'vitest';
import { planRepeatedItems } from './repeat-items';
import { createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
const tracks = createDefaultTracks();
const trackId = tracks.find((track) => track.kind === 'video')!.id;
const a: TimelineItem = {
	id: 'a',
	trackId,
	type: 'text',
	from: 30,
	durationInFrames: 45,
	label: 'Work',
	text: 'Work'
};
const b: TimelineItem = {
	id: 'b',
	trackId,
	type: 'text',
	from: 75,
	durationInFrames: 15,
	label: 'Rest',
	text: 'Rest'
};
it('repeats the whole selection with a gap after each block, preserving its internal spacing', () => {
	const plan = planRepeatedItems({
		items: [a, b],
		tracks,
		transitions: [],
		selectedIds: ['a', 'b'],
		copies: 2,
		gapFrames: 10
	});
	expect(plan?.items.map((item) => [item.from, item.durationInFrames, item.text])).toEqual([
		[100, 45, 'Work'],
		[145, 15, 'Rest'],
		[170, 45, 'Work'],
		[215, 15, 'Rest']
	]);
	expect(new Set(plan?.items.map((item) => item.id)).size).toBe(4);
	expect(plan?.endFrame).toBe(230);
});
it('rejects occupied and locked tracks without shifting footage or returning a partial batch', () => {
	const occupied = { ...a, id: 'footage', from: 150, durationInFrames: 90 };
	expect(
		planRepeatedItems({
			items: [a, b, occupied],
			tracks,
			transitions: [],
			selectedIds: ['a', 'b'],
			copies: 2,
			gapFrames: 0
		})
	).toBeNull();
	expect(
		planRepeatedItems({
			items: [a],
			tracks: tracks.map((track) => ({ ...track, locked: true })),
			transitions: [],
			selectedIds: ['a'],
			copies: 1,
			gapFrames: 0
		})
	).toBeNull();
});
