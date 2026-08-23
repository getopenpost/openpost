/**
 * Equal-power audio crossfade for visual transitions.
 *
 * Ported from FreeCut (MIT) — canvas-audio.ts equal-power sin/cos — retargeted
 * to OpenPost's TimelineTransition windows. Each audible clip that participates
 * in an active visual transition receives a multiplicative gain so the summed
 * power stays constant. The gain composes with existing volume/keyframe and
 * track mute/solo gains.
 */

import type { TimelineItem, TimelineTransition } from '../project/types';
import { resolveTransitionWindow } from '../timeline/transition-planner';

export function equalPowerGain(progress: number, isIncoming: boolean): number {
	const clamped = Math.min(1, Math.max(0, progress));
	if (isIncoming) return Math.sin((clamped * Math.PI) / 2);
	return Math.cos((clamped * Math.PI) / 2);
}

/**
 * Progress of `frame` inside `window`. 0 at window.startFrame inclusive,
 * 1 at window.endFrame exclusive. The caller decides whether to map this
 * linearly to sin/cos; exact endpoints are therefore hit at the window
 * boundaries.
 */
function windowProgress(
	window: { startFrame: number; endFrame: number; durationInFrames: number },
	frame: number
): number {
	if (window.durationInFrames <= 0) return 0;
	return Math.min(1, Math.max(0, (frame - window.startFrame) / window.durationInFrames));
}

/**
 * Check whether `item` participates in `transition` either directly or as a
 * synchronized linked companion (video ↔ audio that share linkedGroupId and
 * timeline position). This mirrors FreeCut's linked-audio transition
 * derivation without duplicating segments.
 */
function isOutgoingParticipant(
	item: TimelineItem,
	transition: TimelineTransition,
	itemsById: Map<string, TimelineItem>
): boolean {
	if (item.id === transition.fromItemId) return true;
	const from = itemsById.get(transition.fromItemId);
	if (!from || !item.linkedGroupId || item.linkedGroupId !== from.linkedGroupId) return false;
	// Synchronized companion: same timeline window as the visual clip
	return item.from === from.from && item.durationInFrames === from.durationInFrames;
}

function isIncomingParticipant(
	item: TimelineItem,
	transition: TimelineTransition,
	itemsById: Map<string, TimelineItem>
): boolean {
	if (item.id === transition.toItemId) return true;
	const to = itemsById.get(transition.toItemId);
	if (!to || !item.linkedGroupId || item.linkedGroupId !== to.linkedGroupId) return false;
	return item.from === to.from && item.durationInFrames === to.durationInFrames;
}

/**
 * Multiplicative crossfade gain for `item` at absolute `frame`.
 * Returns 1 outside any transition window. For clips inside overlapping
 * windows (middle of a 3-clip chain), gains multiply — at most two windows
 * can apply and they occupy disjoint frame ranges, so the product is still 1
 * in the middle unaffected region.
 *
 * Fade-black reuses the same equal-power curve: outgoing fades out in the
 * first half, incoming fades in the second half, silence in the opposite
 * half. This matches the visual dip-to-black while keeping the audio
 * power curve consistent and remaining compatible with future presentation
 * extensions.
 */
export function audioCrossfadeGainAtFrame(
	item: TimelineItem,
	frame: number,
	transitions: TimelineTransition[],
	itemsById: Map<string, TimelineItem>
): number {
	let gain = 1;
	for (const transition of transitions) {
		const from = itemsById.get(transition.fromItemId);
		const to = itemsById.get(transition.toItemId);
		if (!from || !to) continue;
		const window = resolveTransitionWindow(transition, from, to);
		if (!window || frame < window.startFrame || frame >= window.endFrame) continue;

		const progress = windowProgress(window, frame);
		const isOutgoing = isOutgoingParticipant(item, transition, itemsById);
		const isIncoming = isIncomingParticipant(item, transition, itemsById);
		if (!isOutgoing && !isIncoming) continue;

		let localGain = 1;
		if (transition.type === 'fade-black') {
			// Dip to black: fade out in first half, fade in in second half
			if (isOutgoing) {
				localGain = progress < 0.5 ? equalPowerGain(progress * 2, false) : 0;
			} else {
				localGain = progress < 0.5 ? 0 : equalPowerGain((progress - 0.5) * 2, true);
			}
		} else {
			// Crossfade: equal-power across full window
			localGain = isOutgoing ? equalPowerGain(progress, false) : equalPowerGain(progress, true);
		}
		gain *= localGain;
		// If gain hits zero we can short-circuit but keep multiplicative semantics
		if (gain === 0) return 0;
	}
	return gain;
}

/**
 * Apply the crossfade multiplicatively to a single gain value at `frame`.
 * This is the preview path (per-frame HTMLMediaElement volume).
 */
export function applyAudioCrossfadeToGain(
	baseGain: number,
	item: TimelineItem,
	frame: number,
	transitions: TimelineTransition[],
	itemsById: Map<string, TimelineItem>
): number {
	const crossfade = audioCrossfadeGainAtFrame(item, frame, transitions, itemsById);
	return baseGain * crossfade;
}
