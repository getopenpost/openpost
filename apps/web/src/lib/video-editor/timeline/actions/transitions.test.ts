import { beforeEach, describe, expect, it } from 'vitest';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	addTransition,
	incomingOpacity,
	outgoingOpacity,
	removeTransition,
	pruneInvalidTransitions,
	transitionsStore,
	updateTransition,
	updateTransitionPresentation
} from './transitions.svelte';
import { transitionBlendsAtFrame } from '../../media/render-plan';
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

	it('requires touching clips on the same track', () => {
		const [left] = setup();
		const far = clip(500);
		timelineStore._setItems([...timelineStore.items, far]);
		expect(() => addTransition(left.id, far.id)).toThrow();
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

	it('allows one incoming and one outgoing transition on the same clip', () => {
		const [left, middle] = setup();
		const right = clip(120);
		timelineStore._setItems([left, middle, right]);
		addTransition(left.id, middle.id, 'crossfade', 15);
		addTransition(middle.id, right.id, 'crossfade', 15);
		expect(transitionsStore.incomingFor(middle.id)?.fromItemId).toBe(left.id);
		expect(transitionsStore.outgoingFor(middle.id)?.toItemId).toBe(right.id);
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

	it('keeps the first stored transition when reconciling legacy overlapping cuts', () => {
		const [left, middle, right] = [0, 30, 60].map((from) => ({
			...clip(from, 30),
			type: 'image' as const
		}));
		timelineStore._setItems([left!, middle!, right!]);
		const first = addTransition(left!.id, middle!.id, 'crossfade', 29, 0);
		const second = addTransition(middle!.id, right!.id, 'crossfade', 29, 0);
		transitionsStore.setAll(
			transitionsStore.list.map((transition) =>
				transition.id === second ? { ...transition, alignment: 1 } : transition
			)
		);
		pruneInvalidTransitions();
		expect(transitionsStore.list.map((transition) => transition.id)).toEqual([first]);
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

	it('treats reapplying the current presentation as a successful no-op', () => {
		const [left, right] = setup();
		const id = addTransition(left.id, right.id, 'crossfade', 15);
		const undoCount = commandHistory.undoStack.length;

		expect(updateTransitionPresentation(id, 'fade')).toBe(true);
		expect(commandHistory.undoStack).toHaveLength(undoCount);
		expect(transitionsStore.list[0]?.presentation).toBe('fade');
	});

	it('rejects a transition when either clip lacks the required hidden source', () => {
		const [left, right] = setup();
		timelineStore._updateItems([{ id: right.id, patch: { sourceStart: 0 } }]);
		expect(() => addTransition(left.id, right.id, 'crossfade', 15)).toThrow('enough source handle');
	});

	it('computes crossfade progress across the overlap window', () => {
		const [left, right] = setup();
		addTransition(left.id, right.id, 'crossfade', 30);

		const before = transitionBlendsAtFrame(transitionsStore.list, timelineStore.itemById, 44).get(
			left.id
		);
		expect(before).toBeUndefined();

		const mid = transitionBlendsAtFrame(transitionsStore.list, timelineStore.itemById, 60).get(
			left.id
		);
		expect(mid?.progress).toBeCloseTo(15 / 29);
		expect(outgoingOpacity('crossfade', mid!.progress)).toBeCloseTo(14 / 29);
		expect(incomingOpacity('crossfade', mid!.progress)).toBeCloseTo(15 / 29);

		// Past the centered window (frames 45..75) there is no blend.
		const after = transitionBlendsAtFrame(transitionsStore.list, timelineStore.itemById, 90).get(
			left.id
		);
		expect(after).toBeUndefined();
	});

	it('fade-black dips through black in both layers', () => {
		const [left, right] = setup();
		addTransition(left.id, right.id, 'fade-black', 20);
		expect(outgoingOpacity('fade-black', 0.25)).toBeCloseTo(0.5);
		expect(incomingOpacity('fade-black', 0.25)).toBe(0);
		expect(outgoingOpacity('fade-black', 0.75)).toBe(0);
		expect(incomingOpacity('fade-black', 0.75)).toBeCloseTo(0.5);
	});

	it('removes transitions', () => {
		const [left, right] = setup();
		const id = addTransition(left.id, right.id);
		removeTransition(id);
		expect(transitionsStore.list.length).toBe(0);
	});
});
