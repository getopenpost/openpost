import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageEditorHistory } from './history';

describe('OpenPost Image Editor command history', () => {
	afterEach(() => vi.useRealTimers());

	it('applies, undoes, and redoes commands', () => {
		const history = new ImageEditorHistory<number>((value) => value);
		const next = history.execute(1, {
			label: 'Increment',
			apply: (value) => value + 1,
			revert: (value) => value - 1
		});
		expect(next).toBe(2);
		expect(history.undo(next)).toBe(1);
		expect(history.redo(1)).toBe(2);
	});

	it('coalesces continuous edits with the same key', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-24T10:00:00Z'));
		const history = new ImageEditorHistory<{ x: number }>(structuredClone);
		const first = history.execute(
			{ x: 0 },
			{
				label: 'Move',
				coalesceKey: 'layer-1-transform',
				apply: () => ({ x: 10 }),
				revert: () => ({ x: 0 })
			}
		);
		vi.advanceTimersByTime(100);
		const second = history.execute(first, {
			label: 'Move',
			coalesceKey: 'layer-1-transform',
			apply: () => ({ x: 20 }),
			revert: () => first
		});
		expect(history.undo(second)).toEqual({ x: 0 });
		expect(history.redo({ x: 0 })).toEqual({ x: 20 });
	});

	it('drops redo history after a new command', () => {
		const history = new ImageEditorHistory<number>((value) => value);
		const two = history.execute(1, {
			label: 'Increment',
			apply: (value) => value + 1,
			revert: (value) => value - 1
		});
		const one = history.undo(two);
		history.execute(one, {
			label: 'Double',
			apply: (value) => value * 2,
			revert: (value) => value / 2
		});
		expect(history.canRedo).toBe(false);
	});
});
