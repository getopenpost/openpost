import { beforeEach, describe, expect, it } from 'vitest';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { addTransition, transitionsStore, updateTransition } from './transitions.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';

function clip(from: number, duration = 60): TimelineItem {
	return {
		id: crypto.randomUUID(),
		trackId: 'track-video-main',
		from,
		durationInFrames: duration,
		label: 'clip',
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30
	};
}

function setup(): [TimelineItem, TimelineItem] {
	const left = clip(0);
	const right = clip(60);
	timelineStore._setItems([left, right]);
	transitionsStore.clear();
	return [left, right];
}

describe('transitions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('adds a transition between adjacent clips as one undoable step', async () => {
		const [left, right] = setup();
		const id = addTransition(left.id, right.id, 'crossfade', 15);
		expect(transitionsStore.list.length).toBe(1);
		expect(transitionsStore.forItem(left.id)?.id).toBe(id);

		commandHistory.undo();
		expect(transitionsStore.list.length).toBe(0);
		commandHistory.redo();
		expect(transitionsStore.list.length).toBe(1);
	});

	it('rejects overlapping incoming and outgoing transitions without changing either cut', () => {
		const [left, middle, right] = [0, 30, 60].map((from) => ({
			...clip(from, 30),
			type: 'image' as const
		}));
		timelineStore._setItems([left!, middle!, right!]);
		const first = addTransition(left!.id, middle!.id, 'crossfade', 29, 0);
		expect(() => addTransition(middle!.id, right!.id, 'crossfade', 29, 1)).toThrow('overlap');
		expect(transitionsStore.list.map((transition) => transition.id)).toEqual([first]);

		const second = addTransition(middle!.id, right!.id, 'crossfade', 29, 0);
		expect(updateTransition(second, { alignment: 1 })).toBe(false);
		expect(transitionsStore.list.find((transition) => transition.id === second)?.alignment).toBe(0);
	});

	it('updates renderer controls as one validated undo step', () => {
		const [left, right] = setup();
		const id = addTransition(left.id, right.id, 'crossfade', 15);
		expect(
			updateTransition(id, {
				presentation: 'wipe',
				direction: 'from-right',
				timing: 'ease-in-out',
				alignment: 1,
				durationInFrames: 20
			})
		).toBe(true);
		expect(transitionsStore.list[0]).toMatchObject({
			presentation: 'wipe',
			direction: 'from-right',
			timing: 'ease-in-out',
			alignment: 1,
			durationInFrames: 20
		});
		commandHistory.undo();
		expect(transitionsStore.list[0]).toMatchObject({
			presentation: 'fade',
			alignment: 0.5
		});
	});
});
