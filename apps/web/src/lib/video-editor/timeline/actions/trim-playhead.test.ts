import { beforeEach, expect, it } from 'vitest';
import { createDefaultTracks } from '../../project/defaults';
import type { TimelineItem } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { trimItemToPlayhead } from './trim-playhead';

const clip: TimelineItem = {
	id: 'v',
	trackId: 'track-video-main',
	type: 'video',
	label: 'Demo',
	from: 30,
	durationInFrames: 120,
	sourceStart: 0,
	sourceEnd: 120,
	sourceFps: 30,
	mediaId: 'media',
	linkedGroupId: 'av'
};
const audio: TimelineItem = { ...clip, id: 'a', type: 'audio', trackId: 'audio' };
const caption: TimelineItem = {
	id: 'c',
	trackId: 'captions',
	type: 'subtitle',
	label: 'Words',
	from: 30,
	durationInFrames: 120,
	captionSource: {
		type: 'transcript',
		clipId: 'v',
		mediaId: 'media',
		sourceStartSeconds: 0,
		sourceEndSeconds: 4,
		playbackSpeed: 1
	},
	cues: [
		{
			id: 'cue',
			text: 'One two',
			startFrame: 0,
			endFrame: 120,
			words: [
				{ id: 'one', text: 'One', startFrame: 0, endFrame: 60 },
				{ id: 'two', text: 'two', startFrame: 60, endFrame: 120 }
			]
		}
	]
};
beforeEach(() => {
	timelineStore.__resetForTesting();
	const tracks = createDefaultTracks();
	timelineStore._setTracks([
		...tracks,
		{ ...tracks[0]!, id: 'audio', kind: 'audio', order: 20 },
		{ ...tracks[0]!, id: 'captions', kind: 'video', order: 21 }
	]);
	timelineStore._setItems(structuredClone([clip, audio, caption]));
	timelineStore._setCurrentFrame(90);
	commandHistory.clearHistory();
});
it.each(['start', 'end'] as const)(
	'trims %s, linked audio and caption words together without moving other clips',
	(edge) => {
		timelineStore._addItem({ ...clip, id: 'later', linkedGroupId: undefined, from: 200 });
		expect(trimItemToPlayhead('v', edge)).toBe(true);
		const from = edge === 'start' ? 90 : 30;
		for (const id of ['v', 'a'])
			expect(timelineStore.itemById.get(id)).toMatchObject({
				from,
				durationInFrames: 60,
				sourceStart: edge === 'start' ? 60 : 0,
				sourceEnd: edge === 'start' ? 120 : 60
			});
		expect(timelineStore.itemById.get('later')?.from).toBe(200);
		expect(timelineStore.itemById.get('c')).toMatchObject({
			from,
			durationInFrames: 60,
			cues: [{ text: edge === 'start' ? 'two' : 'One', startFrame: 0, endFrame: 60 }]
		});
		commandHistory.undo();
		expect(timelineStore.items.slice(0, 3)).toEqual([clip, audio, caption]);
		expect(commandHistory.canUndo).toBe(false);
		commandHistory.redo();
		expect(timelineStore.itemById.get('v')?.durationInFrames).toBe(60);
	}
);
it.each(['audio', 'captions'])('rejects the whole trim when the %s track is locked', (trackId) => {
	timelineStore._setTracks(
		timelineStore.tracks.map((track) => ({ ...track, locked: track.id === trackId }))
	);
	expect(trimItemToPlayhead('v', 'start')).toBe(false);
	expect(timelineStore.items).toEqual([clip, audio, caption]);
	expect(commandHistory.canUndo).toBe(false);
});
it.each([0, 30, 150, 200])('does not extend or delete a clip when playhead is %i', (frame) => {
	timelineStore._setCurrentFrame(frame);
	expect(trimItemToPlayhead('v', 'end')).toBe(false);
	expect(commandHistory.canUndo).toBe(false);
});
