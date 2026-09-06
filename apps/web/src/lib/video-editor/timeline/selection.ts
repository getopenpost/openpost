/** Pure timeline selection rules ported from FreeCut's item pointer handler. */

import type { TimelineItem } from '../project/types';
import { expandSelectionWithLinkedItems, getLinkedItemIds } from './utils/linked-items';

export interface TimelineItemSelection {
	ids: string[];
	primaryId: string | null;
}

export function updateTimelineItemSelection(
	items: TimelineItem[],
	selectedItemIds: string[],
	itemId: string,
	linkedSelectionEnabled: boolean,
	additive: boolean
): TimelineItemSelection {
	const targetIds = linkedSelectionEnabled ? getLinkedItemIds(items, itemId) : [itemId];
	let ids: string[];
	if (additive) {
		const targetSet = new Set(targetIds);
		const removeTargets = targetIds.some((targetId) => selectedItemIds.includes(targetId));
		ids = removeTargets
			? selectedItemIds.filter((selectedId) => !targetSet.has(selectedId))
			: linkedSelectionEnabled
				? expandSelectionWithLinkedItems(items, [...selectedItemIds, ...targetIds])
				: Array.from(new Set([...selectedItemIds, ...targetIds]));
	} else {
		ids = targetIds;
	}

	return {
		ids,
		primaryId: ids.includes(itemId) ? itemId : (ids.at(-1) ?? null)
	};
}
