import { describe, expect, it } from 'vitest';
import { treeKeyboardAction, type TreeKeyboardItem } from './tree-keyboard';

const items: TreeKeyboardItem[] = [
	{ id: 'group', hasChildren: true, expanded: true },
	{ id: 'child', parentId: 'group', hasChildren: false, expanded: false },
	{ id: 'sibling', hasChildren: false, expanded: false }
];

describe('treeKeyboardAction', () => {
	it('moves through visible rows and returns to the parent', () => {
		expect(treeKeyboardAction({ key: 'ArrowDown' }, items, 0)).toEqual({
			type: 'focus',
			id: 'child'
		});
		expect(treeKeyboardAction({ key: 'ArrowLeft' }, items, 1)).toEqual({
			type: 'focus',
			id: 'group'
		});
	});

	it('opens and closes groups before moving focus', () => {
		const collapsed = [{ ...items[0], expanded: false }, items[2]];
		expect(treeKeyboardAction({ key: 'ArrowRight' }, collapsed, 0)).toEqual({
			type: 'toggle',
			id: 'group'
		});
		expect(treeKeyboardAction({ key: 'ArrowLeft' }, items, 0)).toEqual({
			type: 'toggle',
			id: 'group'
		});
	});

	it('supports Home and End without inventing a second selection model', () => {
		expect(treeKeyboardAction({ key: 'Home' }, items, 2)).toEqual({ type: 'focus', id: 'group' });
		expect(treeKeyboardAction({ key: 'End' }, items, 0)).toEqual({ type: 'focus', id: 'sibling' });
	});
});
