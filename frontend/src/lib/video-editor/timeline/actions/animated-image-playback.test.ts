import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { setAnimatedImagesReversed, setAnimatedImageSpeed } from './animated-image-playback';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function image(id: string): TimelineItem {
	return {
		id,
		trackId: track.id,
		from: 0,
		durationInFrames: 150,
		label: `${id}.gif`,
		type: 'image',
		mediaId: id
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [image('one'), image('two')], fps: 30 });
	commandHistory.clearHistory();
});

describe('animated image playback actions', () => {
	it('changes the animation clock for a selection without stretching either clip', () => {
		expect(setAnimatedImageSpeed(['one', 'two'], 2.25)).toEqual({
			changed: 2,
			locked: 0,
			noop: 0
		});
		expect(
			timelineStore.items.map(({ speed, durationInFrames }) => [speed, durationInFrames])
		).toEqual([
			[2.25, 150],
			[2.25, 150]
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.speed)).toEqual([undefined, undefined]);
	});

	it('reverses the selected animation loops as one edit', () => {
		expect(setAnimatedImagesReversed(['one', 'two'], true).changed).toBe(2);
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([true, true]);
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
