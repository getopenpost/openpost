/** Shared edit-preview draft owned by the timeline gesture. Publishes only while a rolling/ripple/slip/slide edit is active. */

import type { TimelineItem } from '../project/types';

export type EditPreviewKind = 'rolling' | 'ripple' | 'slip' | 'slide';

export interface EditPreviewState {
	kind: EditPreviewKind;
	anchorId: string;
	leftId?: string | null;
	rightId?: string | null;
	handle?: 'start' | 'end';
	baseline: Record<string, TimelineItem>;
	revision: number;
}

const state = $state<{ current: EditPreviewState | null }>({ current: null });

let revisionCounter = 0;

function cloneItem(item: TimelineItem): TimelineItem {
	// SAFETY: $state.snapshot preserves the TimelineItem shape for the editable clone.
	return $state.snapshot(item) as TimelineItem;
}

export const editPreviewStore = {
	get current(): EditPreviewState | null {
		return state.current;
	},
	get isActive(): boolean {
		return state.current !== null;
	},
	begin(input: Omit<EditPreviewState, 'revision'>): void {
		revisionCounter += 1;
		state.current = { ...input, revision: revisionCounter };
	},
	bump(): void {
		if (!state.current) return;
		revisionCounter += 1;
		state.current = { ...state.current, revision: revisionCounter };
	},
	clear(): void {
		if (state.current === null) return;
		state.current = null;
	},
	__resetForTesting(): void {
		state.current = null;
		revisionCounter = 0;
	},
	__setForTesting(next: EditPreviewState | null): void {
		state.current = next;
	}
};

export function buildBaselineMap(items: TimelineItem[], ids: (string | null | undefined)[]) {
	const map: Record<string, TimelineItem> = {};
	const seen = new Set<string>();
	for (const id of ids) {
		if (!id) continue;
		const anchor = items.find((item) => item.id === id);
		if (!anchor) continue;
		if (!seen.has(anchor.id)) {
			map[anchor.id] = cloneItem(anchor);
			seen.add(anchor.id);
		}
		if (anchor.linkedGroupId) {
			for (const candidate of items) {
				if (candidate.linkedGroupId === anchor.linkedGroupId && !seen.has(candidate.id)) {
					map[candidate.id] = cloneItem(candidate);
					seen.add(candidate.id);
				}
			}
		}
	}
	return map;
}
