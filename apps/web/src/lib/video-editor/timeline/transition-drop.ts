/** Cut-targeted transition drag state, adapted from FreeCut's MIT-licensed interaction. */

import type {
	TimelineItem,
	TimelineTransition,
	TimelineTrack,
	TransitionDirection
} from '../project/types';
import { getMaxTransitionDuration } from './transition-planner';
import { transitionRegistry } from '../transitions';

export const TRANSITION_DRAG_MIME = 'application/x-openpost-transition-v1';

export interface TransitionDragData {
	presentation: string;
	direction?: TransitionDirection;
	label: string;
}

export interface TransitionDropTarget {
	fromItemId: string;
	toItemId: string;
	edge: 'left' | 'right';
	existingTransitionId?: string;
	suggestedDurationInFrames: number;
}

let cachedTransitionDragData: TransitionDragData | null = null;

export function setTransitionDragData(data: TransitionDragData): void {
	cachedTransitionDragData = data;
}

export function getTransitionDragData(): TransitionDragData | null {
	return cachedTransitionDragData;
}

export function clearTransitionDragData(): void {
	cachedTransitionDragData = null;
}

export function isTransitionClip(item: Pick<TimelineItem, 'type'>): boolean {
	return item.type === 'video' || item.type === 'image' || item.type === 'composition';
}

function touching(left: TimelineItem, right: TimelineItem): boolean {
	return Math.abs(left.from + left.durationInFrames - right.from) <= 1;
}

function candidateForEdge(
	item: TimelineItem,
	edge: 'left' | 'right',
	items: readonly TimelineItem[]
): { from: TimelineItem; to: TimelineItem } | null {
	const sameTrack = items.filter(
		(candidate) =>
			candidate.id !== item.id && candidate.trackId === item.trackId && isTransitionClip(candidate)
	);
	if (edge === 'right') {
		const next = sameTrack
			.filter((candidate) => touching(item, candidate))
			.toSorted((left, right) => left.from - right.from)[0];
		return next ? { from: item, to: next } : null;
	}
	const previous = sameTrack
		.filter((candidate) => touching(candidate, item))
		.toSorted((left, right) => right.from - left.from)[0];
	return previous ? { from: previous, to: item } : null;
}

export function resolveTransitionDropTarget(params: {
	itemId: string;
	edge: 'left' | 'right';
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions: readonly TimelineTransition[];
	fps: number;
	presentation: string;
}): TransitionDropTarget | null {
	const { itemId, edge, items, tracks, transitions, fps, presentation } = params;
	const item = items.find((candidate) => candidate.id === itemId);
	if (!item || !isTransitionClip(item)) return null;
	const track = tracks.find((candidate) => candidate.id === item.trackId);
	if (!track || track.locked || track.kind === 'audio') return null;
	const pair = candidateForEdge(item, edge, items);
	if (!pair) return null;
	const existing = transitions.find(
		(transition) => transition.fromItemId === pair.from.id && transition.toItemId === pair.to.id
	);
	const definition = transitionRegistry.getDefinition(presentation);
	if (!definition) return null;
	const maximum = getMaxTransitionDuration(pair.from, pair.to, 0.5, fps);
	if (maximum < definition.minDuration) return null;
	return {
		fromItemId: pair.from.id,
		toItemId: pair.to.id,
		edge,
		existingTransitionId: existing?.id,
		suggestedDurationInFrames: Math.min(
			definition.maxDuration,
			maximum,
			Math.max(definition.minDuration, definition.defaultDuration)
		)
	};
}

export function resolveTransitionTargetFromSelection(params: {
	selectedItemId: string | null;
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions: readonly TimelineTransition[];
	fps: number;
	presentation: string;
}): TransitionDropTarget | null {
	if (!params.selectedItemId) return null;
	const common = {
		itemId: params.selectedItemId,
		items: params.items,
		tracks: params.tracks,
		transitions: params.transitions,
		fps: params.fps,
		presentation: params.presentation
	};
	return (
		resolveTransitionDropTarget({ ...common, edge: 'right' }) ??
		resolveTransitionDropTarget({ ...common, edge: 'left' })
	);
}
