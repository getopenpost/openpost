import { describe, expect, it } from 'vitest';
import { restoreTabSelection, stashTabSelection, tabSelectionKey } from './tab-selection';

describe('tabSelectionKey', () => {
	it('maps the root timeline to a stable key', () => {
		expect(tabSelectionKey(null)).toBe('__root__');
		expect(tabSelectionKey('seq-1')).toBe('seq-1');
	});
});

describe('stashTabSelection / restoreTabSelection', () => {
	it('round-trips a tab selection', () => {
		const memory = new Map<string, string[]>();
		stashTabSelection(memory, 'seq-1', ['a', 'b']);
		expect(restoreTabSelection(memory, 'seq-1', new Set(['a', 'b', 'c']))).toEqual(['a', 'b']);
	});

	it('returns an empty selection for unknown tabs', () => {
		expect(restoreTabSelection(new Map(), 'seq-9', new Set(['a']))).toEqual([]);
	});

	it('drops ids that no longer exist on the timeline', () => {
		const memory = new Map<string, string[]>();
		stashTabSelection(memory, 'seq-1', ['a', 'deleted']);
		expect(restoreTabSelection(memory, 'seq-1', new Set(['a']))).toEqual(['a']);
	});

	it('keeps per-tab selections independent', () => {
		const memory = new Map<string, string[]>();
		stashTabSelection(memory, 'seq-1', ['a']);
		stashTabSelection(memory, 'seq-2', ['b', 'c']);
		expect(restoreTabSelection(memory, 'seq-1', new Set(['a', 'b', 'c']))).toEqual(['a']);
		expect(restoreTabSelection(memory, 'seq-2', new Set(['a', 'b', 'c']))).toEqual(['b', 'c']);
	});

	it('overwrites the stash when leaving a tab again', () => {
		const memory = new Map<string, string[]>();
		stashTabSelection(memory, 'seq-1', ['a']);
		stashTabSelection(memory, 'seq-1', []);
		expect(restoreTabSelection(memory, 'seq-1', new Set(['a']))).toEqual([]);
	});

	it('copies the input so later mutations do not leak', () => {
		const memory = new Map<string, string[]>();
		const ids = ['a'];
		stashTabSelection(memory, 'seq-1', ids);
		ids.push('b');
		expect(restoreTabSelection(memory, 'seq-1', new Set(['a', 'b']))).toEqual(['a']);
	});
});
