/**
 * Cut-centered transition actions shared by the picker, timeline, preview,
 * and export renderer.
 *
 * A transition lives between two items that touch edge-to-edge on the same
 * track. Splits refuse to land inside a transition zone (FreeCut semantics).
 *
 * Ported from FreeCut (MIT) transition model, trimmed to two v1 types.
 */

import type {
	TimelineItem,
	TimelineTransition,
	TransitionDirection,
	TransitionPropertyValue,
	TransitionTiming
} from '../../project/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import {
	calculateTransitionProgress,
	canPreserveTransition,
	getMaxTransitionDuration,
	resolveTransitionWindow
} from '../transition-planner';
import { transitionRegistry } from '../../transitions';

export { transitionsStore } from './transitions-store.svelte';

export interface TransitionCreateOptions {
	alignment?: number;
	presentation?: string;
	direction?: TransitionDirection;
	timing?: TransitionTiming;
	properties?: Record<string, TransitionPropertyValue>;
}

export type TransitionUpdates = Partial<
	Pick<
		TimelineTransition,
		| 'durationInFrames'
		| 'type'
		| 'presentation'
		| 'direction'
		| 'timing'
		| 'alignment'
		| 'bezierPoints'
		| 'properties'
	>
>;

function transitionTypeForPresentation(presentation: string): TimelineTransition['type'] {
	return presentation === 'dipToColorDissolve' ? 'fade-black' : 'crossfade';
}

function defaultTransitionProperties(presentation: string) {
	const definition = transitionRegistry.getDefinition(presentation);
	return Object.fromEntries(
		(definition?.parameters ?? []).map((parameter) => [parameter.key, parameter.defaultValue])
	);
}

function transitionValuesEqual(left: TimelineTransition, right: TimelineTransition): boolean {
	return (
		left.durationInFrames === right.durationInFrames &&
		left.type === right.type &&
		left.presentation === right.presentation &&
		left.direction === right.direction &&
		left.timing === right.timing &&
		(left.alignment ?? 0.5) === (right.alignment ?? 0.5) &&
		JSON.stringify(left.bezierPoints) === JSON.stringify(right.bezierPoints) &&
		JSON.stringify(left.properties) === JSON.stringify(right.properties)
	);
}

function isNumberValue(value: unknown): value is number {
	return typeof value === 'number';
}

function findEdgePair(
	fromItemId: string,
	toItemId: string
): { from: TimelineItem; to: TimelineItem } | null {
	const from = timelineStore.itemById.get(fromItemId);
	const to = timelineStore.itemById.get(toItemId);
	if (!from || !to || from.trackId !== to.trackId) return null;
	return Math.abs(from.from + from.durationInFrames - to.from) <= 1 ? { from, to } : null;
}

export function addTransition(
	fromItemId: string,
	toItemId: string,
	type: TimelineTransition['type'] = 'crossfade',
	durationInFrames?: number,
	alignmentOrOptions?: number | TransitionCreateOptions
): string {
	// SAFETY: execute returns the action's own string result unchanged.
	return execute('ADD_TRANSITION', () => {
		const pair = findEdgePair(fromItemId, toItemId);
		if (!pair) {
			throw new Error('Transitions need two touching clips on the same track');
		}
		const existing = transitionsStore.list.find(
			(transition) => transition.fromItemId === fromItemId && transition.toItemId === toItemId
		);
		if (existing) throw new Error('Clips already have a transition here');
		const options = isNumberValue(alignmentOrOptions)
			? { alignment: alignmentOrOptions }
			: (alignmentOrOptions ?? {});
		const presentation =
			options.presentation ?? (type === 'fade-black' ? 'dipToColorDissolve' : 'fade');
		const definition = transitionRegistry.getDefinition(presentation);
		const normalizedType = transitionTypeForPresentation(presentation);
		const alignment = options.alignment ?? 0.5;
		const availableMax = getMaxTransitionDuration(pair.from, pair.to, alignment, timelineStore.fps);
		const minimum = definition?.minDuration ?? 2;
		if (availableMax < minimum) {
			throw new Error('Clips do not have enough source handle for this transition');
		}
		const frames = Math.min(
			availableMax,
			definition?.maxDuration ?? availableMax,
			Math.max(minimum, Math.round(durationInFrames ?? definition?.defaultDuration ?? 30))
		);
		const transition: TimelineTransition = {
			id: crypto.randomUUID(),
			type: normalizedType,
			presentation,
			timing:
				options.timing && definition?.supportedTimings.includes(options.timing)
					? options.timing
					: (definition?.supportedTimings[0] ?? 'linear'),
			direction: definition?.hasDirection
				? options.direction && definition.directions?.includes(options.direction)
					? options.direction
					: definition.directions?.[0]
				: undefined,
			properties: options.properties ?? defaultTransitionProperties(presentation),
			durationInFrames: frames,
			alignment,
			fromItemId,
			toItemId
		};
		if (!canPreserveTransition(transition, pair.from, pair.to, timelineStore.fps)) {
			throw new Error('Clips do not have enough source handle for this transition');
		}
		transitionsStore.list.push(transition);
		return transition.id;
	}) as string;
}

export function updateTransition(id: string, updates: TransitionUpdates): boolean {
	return execute('UPDATE_TRANSITION', () => {
		const current = transitionsStore.list.find((transition) => transition.id === id);
		if (!current) return false;
		const next: TimelineTransition = {
			...current,
			...updates,
			...(updates.properties && { properties: { ...updates.properties } }),
			durationInFrames: Math.max(
				1,
				Math.round(updates.durationInFrames ?? current.durationInFrames)
			),
			alignment: Math.min(1, Math.max(0, updates.alignment ?? current.alignment ?? 0.5))
		};
		const pair = findEdgePair(current.fromItemId, current.toItemId);
		if (!pair || !canPreserveTransition(next, pair.from, pair.to, timelineStore.fps)) return false;
		if (transitionValuesEqual(current, next)) return false;
		transitionsStore.setAll(
			transitionsStore.list.map((transition) => (transition.id === id ? next : transition))
		);
		return true;
	});
}

/** Replace a transition presentation with valid duration, timing, direction, and defaults. */
export function updateTransitionPresentation(
	id: string,
	presentation: string,
	direction?: TransitionDirection
): boolean {
	const current = transitionsStore.list.find((transition) => transition.id === id);
	const definition = transitionRegistry.getDefinition(presentation);
	if (!current || !definition) return false;
	const pair = findEdgePair(current.fromItemId, current.toItemId);
	if (!pair) return false;
	const available = getMaxTransitionDuration(
		pair.from,
		pair.to,
		current.alignment ?? 0.5,
		timelineStore.fps
	);
	if (available < definition.minDuration) return false;
	const durationInFrames = Math.min(
		available,
		definition.maxDuration,
		Math.max(definition.minDuration, current.durationInFrames)
	);
	const timing = definition.supportedTimings.includes(current.timing ?? 'linear')
		? (current.timing ?? 'linear')
		: definition.supportedTimings[0];
	const normalizedDirection = definition.hasDirection
		? direction && definition.directions?.includes(direction)
			? direction
			: definition.directions?.[0]
		: undefined;
	const updates: TransitionUpdates = {
		presentation,
		type: transitionTypeForPresentation(presentation),
		durationInFrames,
		timing,
		direction: normalizedDirection,
		bezierPoints: timing === 'cubic-bezier' ? current.bezierPoints : undefined,
		properties: defaultTransitionProperties(presentation)
	};
	const next: TimelineTransition = {
		...current,
		...updates,
		properties: { ...updates.properties }
	};
	if (transitionValuesEqual(current, next)) return true;
	return updateTransition(id, updates);
}

export function removeTransition(id: string): void {
	execute('REMOVE_TRANSITION', () => {
		transitionsStore.setAll(transitionsStore.list.filter((t) => t.id !== id));
	});
}

/** Drop transitions referencing removed items; called after removal edits. */
export function pruneOrphanedTransitions(): void {
	const byId = timelineStore.itemById;
	const next = transitionsStore.list.filter((t) => byId.has(t.fromItemId) && byId.has(t.toItemId));
	if (next.length !== transitionsStore.list.length) transitionsStore.setAll(next);
}

/** Drop transitions whose clips no longer share a valid cut after a structural edit. */
export function pruneInvalidTransitions(): void {
	const next = transitionsStore.list.filter((transition) => {
		const pair = findEdgePair(transition.fromItemId, transition.toItemId);
		return !!pair && canPreserveTransition(transition, pair.from, pair.to, timelineStore.fps);
	});
	if (next.length !== transitionsStore.list.length) transitionsStore.setAll(next);
}

/** Opacity of the incoming clip at progress 0..1 for the transition type. */
export function incomingOpacity(type: TimelineTransition['type'], progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	if (type === 'fade-black') return p < 0.5 ? 0 : (p - 0.5) * 2;
	return p;
}

/** Opacity of the outgoing clip at progress 0..1 for the transition type. */
export function outgoingOpacity(type: TimelineTransition['type'], progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	if (type === 'fade-black') return p < 0.5 ? 1 - p * 2 : 0;
	return 1 - p;
}

/**
 * Transition state at an absolute timeline frame for a pair of clips.
 * Returns null outside the window; otherwise the pair + blend progress.
 */
export function transitionAtFrame(
	transition: TimelineTransition,
	frame: number,
	fpsForDuration: number
): {
	outgoing: string;
	incoming: string;
	progress: number;
	type: TimelineTransition['type'];
	transition: TimelineTransition;
} | null {
	const from = timelineStore.itemById.get(transition.fromItemId);
	const to = timelineStore.itemById.get(transition.toItemId);
	if (!from || !to) return null;
	const window = resolveTransitionWindow(transition, from, to);
	if (!window || frame < window.startFrame || frame >= window.endFrame) return null;
	const progress = calculateTransitionProgress(
		frame - window.startFrame,
		window.durationInFrames,
		transition.timing,
		transition.bezierPoints
	);
	void fpsForDuration;
	return {
		outgoing: from.id,
		incoming: to.id,
		progress,
		type: transition.type,
		transition
	};
}
