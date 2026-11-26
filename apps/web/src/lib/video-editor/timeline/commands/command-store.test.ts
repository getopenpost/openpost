import { beforeEach, describe, expect, it } from 'vitest';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	commandHistory,
	execute,
	executeAtomic,
	executeAtomicBoolean
} from './command-store.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: crypto.randomUUID(),
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 90,
		label: 'clip',
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 0,
		sourceDuration: 900,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

describe('command history', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('execute records one undo entry only when state changed', () => {
		execute('ADD_ITEMS', () => {
			timelineStore._setItems([videoItem()]);
		});
		expect(commandHistory.undoStack.length).toBe(1);

		execute('NOOP', () => undefined);
		expect(commandHistory.undoStack.length).toBe(1);
	});

	it('undo restores previous items and redo re-applies them', () => {
		const item = videoItem({ durationInFrames: 30 });
		timelineStore._setItems([item]);

		execute('REMOVE_ITEMS', () => {
			timelineStore._removeItems([item.id]);
		});
		expect(timelineStore.items.length).toBe(0);
		expect(commandHistory.canUndo).toBe(true);

		commandHistory.undo();
		expect(timelineStore.items.length).toBe(1);
		expect(commandHistory.canRedo).toBe(true);

		commandHistory.redo();
		expect(timelineStore.items.length).toBe(0);
	});

	it('collapses nested commands into one complete undo and redo transaction', () => {
		const first = videoItem({ id: 'first', transform: { x: 0, y: 0 } });
		const second = videoItem({ id: 'second', transform: { x: 20, y: 30 } });
		timelineStore._setItems([first, second]);

		executeAtomic('GROUP_TRANSFORM', () => {
			execute('UPDATE_FIRST', () => {
				timelineStore._updateItems([{ id: first.id, patch: { transform: { x: 100, y: 50 } } }]);
			});
			executeAtomic('NESTED_GROUP_TRANSFORM', () => {
				execute('UPDATE_SECOND', () => {
					timelineStore._updateItems([{ id: second.id, patch: { transform: { x: -40, y: 75 } } }]);
				});
			});
		});

		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('GROUP_TRANSFORM');
		expect(timelineStore.itemById.get(first.id)?.transform).toEqual({
			x: 100,
			y: 50
		});
		expect(timelineStore.itemById.get(second.id)?.transform).toEqual({
			x: -40,
			y: 75
		});

		commandHistory.undo();
		expect(timelineStore.itemById.get(first.id)?.transform).toEqual({
			x: 0,
			y: 0
		});
		expect(timelineStore.itemById.get(second.id)?.transform).toEqual({
			x: 20,
			y: 30
		});

		commandHistory.redo();
		expect(timelineStore.itemById.get(first.id)?.transform).toEqual({
			x: 100,
			y: 50
		});
		expect(timelineStore.itemById.get(second.id)?.transform).toEqual({
			x: -40,
			y: 75
		});
	});

	it('rolls back every nested mutation when an atomic action reports failure', () => {
		const first = videoItem({ id: 'first', transform: { x: 0, y: 0 } });
		const second = videoItem({ id: 'second', transform: { x: 20, y: 30 } });
		timelineStore._setItems([first, second]);
		keyframeSelectionStore.replace(first.id, ['first-key']);

		const committed = executeAtomicBoolean('GROUP_TRANSFORM', () => {
			execute('UPDATE_FIRST', () => {
				timelineStore._updateItems([{ id: first.id, patch: { transform: { x: 100, y: 50 } } }]);
			});
			keyframeSelectionStore.replace(second.id, ['stale-key']);
			return false;
		});

		expect(committed).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(timelineStore.itemById.get(first.id)?.transform).toEqual({
			x: 0,
			y: 0
		});
		expect(timelineStore.itemById.get(second.id)?.transform).toEqual({
			x: 20,
			y: 30
		});
		expect(keyframeSelectionStore.itemId).toBe(first.id);
		expect([...keyframeSelectionStore.ids]).toEqual(['first-key']);
	});
});

describe('_splitItem source boundaries', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('splits durations and shifts the right piece source window at 1x', () => {
		const item = videoItem({
			durationInFrames: 60,
			sourceStart: 300,
			sourceFps: 30,
			speed: 1
		});
		timelineStore._setItems([item]);

		const result = timelineStore._splitItem(item.id, item.from + 18);
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.leftItem.durationInFrames).toBe(18);
		expect(result.rightItem.durationInFrames).toBe(42);
		expect(result.rightItem.sourceStart).toBe(300 + 18);
		expect(result.rightItem.from).toBe(item.from + 18);
	});

	it('splits a reversed clip into descending source windows without a discontinuity', () => {
		const item = videoItem({
			durationInFrames: 60,
			sourceStart: 300,
			sourceEnd: 360,
			sourceDuration: 600,
			sourceFps: 30,
			speed: 1,
			isReversed: true
		});
		timelineStore._setItems([item]);

		const result = timelineStore._splitItem(item.id, item.from + 18);
		expect(result?.leftItem).toMatchObject({
			sourceStart: 342,
			sourceEnd: 360
		});
		expect(result?.rightItem).toMatchObject({
			sourceStart: 300,
			sourceEnd: 342
		});
	});
});

describe('failed edit recovery', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});
	it.each([execute, executeAtomic])('restores the document when a command throws', (run) => {
		const item = videoItem();
		timelineStore._setItems([item]);
		expect(() =>
			run('FAIL', () => {
				timelineStore._removeItems([item.id]);
				throw new Error('edit failed');
			})
		).toThrow('edit failed');
		expect(timelineStore.items.map((item) => item.id)).toEqual([item.id]);
		expect(commandHistory.canUndo).toBe(false);
	});
});
