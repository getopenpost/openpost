import { afterEach, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { captureSnapshot } from '../commands/snapshot.svelte';
import { planLinkedSlipGesture } from '../edit-gesture';
import { timelineStore } from '../stores/timeline-store.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('commits a clamped slip gesture with its source ramp and restores exact authored state on undo and redo', () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	const original: TimelineItem = {
		id: 'clip',
		trackId: 'track-video-main',
		from: 100,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		sourceStart: 10,
		sourceEnd: 40,
		sourceDuration: 45,
		sourceFps: 30,
		speedRamp: [
			{ id: 'start', sourceFrame: 10, speed: 1, easing: 'hold' },
			{ id: 'fast', sourceFrame: 25, speed: 2, easing: 'hold' },
			{ id: 'end', sourceFrame: 40, speed: 1, easing: 'linear' }
		]
	};
	timelineStore._setItems([structuredClone(original)]);
	const before = captureSnapshot();
	// The UI supplies timeline-frame deltas, applies the plan, then records the gesture.
	const updates = planLinkedSlipGesture(original, -500, timelineStore.items, 30);
	timelineStore._updateItems(updates);
	commandHistory.addUndoEntry({ type: 'SLIP_ITEM' }, before);
	const slipped = timelineStore.itemById.get('clip')!;
	expect(slipped).toMatchObject({
		from: 100,
		durationInFrames: 30,
		sourceStart: 15,
		sourceEnd: 45,
		speedRamp: [
			{ id: 'start', sourceFrame: 15, speed: 1, easing: 'hold' },
			{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
			{ id: 'end', sourceFrame: 45, speed: 1, easing: 'linear' }
		]
	});
	expect(planLinkedSlipGesture(slipped, 500, timelineStore.items, 30)).toEqual([
		{
			id: 'clip',
			patch: {
				sourceStart: 0,
				sourceEnd: 30,
				speedRamp: [
					{ id: 'start', sourceFrame: 0, speed: 1, easing: 'hold' },
					{ id: 'fast', sourceFrame: 15, speed: 2, easing: 'hold' },
					{ id: 'end', sourceFrame: 30, speed: 1, easing: 'linear' }
				]
			}
		}
	]);
	expect(commandHistory.undoStack).toHaveLength(1);
	commandHistory.undo();
	expect(timelineStore.items).toEqual([original]);
	expect(commandHistory.canUndo).toBe(false);
	commandHistory.redo();
	expect(timelineStore.items).toEqual([slipped]);
});
