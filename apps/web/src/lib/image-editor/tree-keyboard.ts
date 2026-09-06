export interface TreeKeyboardItem {
	id: string;
	parentId?: string;
	hasChildren: boolean;
	expanded: boolean;
}

export type TreeKeyboardAction =
	| { type: 'focus'; id: string }
	| { type: 'toggle'; id: string }
	| { type: 'none' };

export function treeKeyboardAction(
	event: Pick<KeyboardEvent, 'key'>,
	items: readonly TreeKeyboardItem[],
	index: number
): TreeKeyboardAction {
	const item = items[index];
	if (!item) return { type: 'none' };
	const previous = items[index - 1];
	const next = items[index + 1];

	if (event.key === 'ArrowDown' && next) return { type: 'focus', id: next.id };
	if (event.key === 'ArrowUp' && previous) return { type: 'focus', id: previous.id };
	if (event.key === 'Home' && items[0]) return { type: 'focus', id: items[0].id };
	if (event.key === 'End' && items.at(-1)) return { type: 'focus', id: items.at(-1)!.id };
	if (event.key === 'ArrowRight') {
		if (item.hasChildren && !item.expanded) return { type: 'toggle', id: item.id };
		if (next && next.parentId === item.id) return { type: 'focus', id: next.id };
	}
	if (event.key === 'ArrowLeft') {
		if (item.hasChildren && item.expanded) return { type: 'toggle', id: item.id };
		if (item.parentId) return { type: 'focus', id: item.parentId };
	}
	return { type: 'none' };
}
