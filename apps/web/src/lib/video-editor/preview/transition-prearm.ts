/**
 * Paused-lane transition hold for the program monitor.
 *
 * Ported from FreeCut (MIT) `preview/utils/transition-dom-playback.ts`
 * (`synchronizePausedTransitionDomVideo`, 0.001s seek epsilon, `dataset`
 * ramp-owned lane flags, paused-lane prearm for A-A transitions).
 *
 * Mapping note: our transitions have no A-A source-time ramps; both lanes
 * decode at ordinary clip-local source times through the shared compositor.
 * The ported behavior is therefore the hold itself: while paused inside a
 * transition window, the participant element keeps its transition-relative
 * decoded frame instead of issuing a cold random-access seek on every scrub
 * tick. `hasActiveSourceRamp` is true for held participants because both
 * lanes are ramp-driven (opacity/progress blend) for the window duration.
 */

import type { TimelineItem, TimelineTransition } from '../project/types';
import {
	calculateTransitionProgress,
	resolveTransitionWindow
} from '../timeline/transition-planner';

/** 0.001s seek epsilon, matching FreeCut's paused-lane settle threshold. */
export const TRANSITION_HOLD_SEEK_EPSILON_SECONDS = 0.001;

export interface TransitionHoldState {
	transitionId: string;
	outgoing: boolean;
	startFrame: number;
	endFrame: number;
	progress: number;
}

export interface TransitionHoldLookup {
	itemId: string;
	frame: number;
	transitions: readonly TimelineTransition[];
	itemById: ReadonlyMap<string, TimelineItem>;
}

/**
 * Find the transition window holding `itemId` at `frame`. Returns null
 * outside every window, mirroring `resolveTransitionDomPlaybackState`'s
 * out-of-window null (frame < start || frame >= end).
 */
export function findTransitionHold(lookup: TransitionHoldLookup): TransitionHoldState | null {
	const { itemId, frame, transitions, itemById } = lookup;
	for (const transition of transitions) {
		if (transition.fromItemId !== itemId && transition.toItemId !== itemId) continue;
		const from = itemById.get(transition.fromItemId);
		const to = itemById.get(transition.toItemId);
		if (!from || !to) continue;
		const window = resolveTransitionWindow(transition, from, to);
		if (!window || frame < window.startFrame || frame >= window.endFrame) continue;
		return {
			transitionId: transition.id,
			outgoing: itemId === from.id,
			startFrame: window.startFrame,
			endFrame: window.endFrame,
			progress: calculateTransitionProgress(
				frame - window.startFrame,
				window.durationInFrames,
				transition.timing,
				transition.bezierPoints
			)
		};
	}
	return null;
}

export interface TransitionMediaHoldResult {
	/** True when the element already holds the target within epsilon. */
	held: boolean;
	/** True when a fresh seek was issued on this call. */
	seekIssued: boolean;
}

/**
 * Position a paused media lane on its transition-relative source time.
 * Marks the lane ramp-owned so the compositor consumes the held decoded
 * frame instead of falling through to a cold decode while skimming.
 */
export function synchronizePausedTransitionMedia(
	element: HTMLVideoElement,
	sourceTime: number
): TransitionMediaHoldResult {
	element.dataset.transitionHold = '1';
	element.dataset.transitionSourceRamp = '1';
	if (!element.paused) {
		try {
			element.pause();
		} catch {
			// A settling pooled element reports paused on the next media event.
		}
	}
	if (
		element.readyState >= 1 &&
		Math.abs(element.currentTime - sourceTime) > TRANSITION_HOLD_SEEK_EPSILON_SECONDS
	) {
		try {
			element.currentTime = sourceTime;
		} catch {
			// Metadata or the pooled element can still be settling; the next
			// scrub tick retries the hovered frame.
		}
		return { held: false, seekIssued: true };
	}
	return { held: true, seekIssued: false };
}

/** Release the ramp-owned flags when the playhead leaves the window. */
export function clearTransitionHold(element: HTMLVideoElement): void {
	delete element.dataset.transitionHold;
	delete element.dataset.transitionSourceRamp;
}
