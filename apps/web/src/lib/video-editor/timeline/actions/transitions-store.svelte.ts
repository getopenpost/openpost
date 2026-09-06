/**
 * Transitions domain store.
 *
 * Kept separate from transition *actions* so the snapshot system can import
 * it without a circular dependency through the command store.
 */

import type { TimelineItem, TimelineTransition } from '../../project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { calculateTransitionPortions } from '../transition-planner';

const state = $state<{ transitions: TimelineTransition[] }>({ transitions: [] });

export const transitionsStore = {
	get list(): TimelineTransition[] {
		return state.transitions;
	},
	forItem(itemId: string): TimelineTransition | undefined {
		return state.transitions.find((t) => t.fromItemId === itemId || t.toItemId === itemId);
	},
	incomingFor(itemId: string): TimelineTransition | undefined {
		return state.transitions.find((transition) => transition.toItemId === itemId);
	},
	outgoingFor(itemId: string): TimelineTransition | undefined {
		return state.transitions.find((transition) => transition.fromItemId === itemId);
	},
	between(fromItemId: string, toItemId: string): TimelineTransition | undefined {
		return state.transitions.find(
			(transition) => transition.fromItemId === fromItemId && transition.toItemId === toItemId
		);
	},
	/** The in-progress transition overlapping a frame inside an item, if any. */
	at(item: { id: string; from: number }, relativeFrame: number): TimelineTransition | null {
		for (const t of state.transitions) {
			if (t.fromItemId !== item.id) continue;
			const from = timelineStore.itemById.get(t.fromItemId);
			if (!from) continue;
			const { leftPortion } = calculateTransitionPortions(t.durationInFrames, t.alignment);
			const start = from.durationInFrames - leftPortion;
			if (relativeFrame >= start) return t;
		}
		for (const t of state.transitions) {
			if (t.toItemId !== item.id) continue;
			const { rightPortion } = calculateTransitionPortions(t.durationInFrames, t.alignment);
			if (relativeFrame < rightPortion) return t;
		}
		return null;
	},
	setAll(list: TimelineTransition[]): void {
		state.transitions = list;
	},
	clear(): void {
		state.transitions = [];
	}
};

export type { TimelineItem };
