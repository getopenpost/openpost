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

export interface TransitionGainSpan {
	startSeconds: number;
	durationSeconds: number;
	isIncoming: boolean;
	dipToSilence: boolean;
}

export interface TransitionAudioExtent {
	beforeFrames: number;
	afterFrames: number;
}

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
	if (window.durationInFrames <= 1) return frame >= window.startFrame ? 1 : 0;
	return Math.min(1, Math.max(0, (frame - window.startFrame) / (window.durationInFrames - 1)));
}

/**
 * Check whether `item` participates in `transition` either directly or as a
 * synchronized linked companion (video ↔ audio that share linkedGroupId and
 * timeline position). This mirrors FreeCut's linked-audio transition
 * derivation without duplicating segments.
 */
export function isOutgoingTransitionParticipant(
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

export function isIncomingTransitionParticipant(
	item: TimelineItem,
	transition: TimelineTransition,
	itemsById: Map<string, TimelineItem>
): boolean {
	if (item.id === transition.toItemId) return true;
	const to = itemsById.get(transition.toItemId);
	if (!to || !item.linkedGroupId || item.linkedGroupId !== to.linkedGroupId) return false;
	return item.from === to.from && item.durationInFrames === to.durationInFrames;
}

export function hasLinkedAudioCompanion(item: TimelineItem, items: TimelineItem[]): boolean {
	if (item.type !== 'video' || !item.linkedGroupId) return false;
	return items.some(
		(candidate) =>
			candidate.type === 'audio' &&
			candidate.linkedGroupId === item.linkedGroupId &&
			candidate.from === item.from &&
			candidate.durationInFrames === item.durationInFrames
	);
}

export function transitionGainAtProgress(
	progress: number,
	isIncoming: boolean,
	dipToSilence: boolean
): number {
	if (!dipToSilence) return equalPowerGain(progress, isIncoming);
	if (isIncoming) {
		return progress < 0.5 ? 0 : equalPowerGain((progress - 0.5) * 2, true);
	}
	return progress < 0.5 ? equalPowerGain(progress * 2, false) : 0;
}

export function buildTransitionGainCurve(
	span: TransitionGainSpan,
	startSeconds: number,
	endSeconds: number,
	sampleRate: number
): Float32Array {
	const durationSeconds = Math.max(0, endSeconds - startSeconds);
	const sampleCount = Math.max(2, Math.ceil(durationSeconds * sampleRate) + 1);
	const curve = new Float32Array(sampleCount);
	for (let index = 0; index < sampleCount; index++) {
		const time = startSeconds + (durationSeconds * index) / (sampleCount - 1);
		const progress =
			span.durationSeconds > 0 ? (time - span.startSeconds) / span.durationSeconds : 1;
		curve[index] = transitionGainAtProgress(progress, span.isIncoming, span.dipToSilence);
	}
	return curve;
}

function sourceFramesToTimelineFrames(
	sourceFrames: number,
	item: TimelineItem,
	fps: number
): number {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	return Math.floor((Math.max(0, sourceFrames) / sourceFps / speed) * fps);
}

export function transitionAudioExtentForItem(
	item: TimelineItem,
	transitions: TimelineTransition[],
	itemsById: Map<string, TimelineItem>,
	fps: number
): TransitionAudioExtent {
	let requestedBefore = 0;
	let requestedAfter = 0;
	for (const transition of transitions) {
		const from = itemsById.get(transition.fromItemId);
		const to = itemsById.get(transition.toItemId);
		if (!from || !to) continue;
		const window = resolveTransitionWindow(transition, from, to);
		if (!window) continue;
		if (isIncomingTransitionParticipant(item, transition, itemsById)) {
			requestedBefore = Math.max(requestedBefore, item.from - window.startFrame);
		}
		if (isOutgoingTransitionParticipant(item, transition, itemsById)) {
			requestedAfter = Math.max(
				requestedAfter,
				window.endFrame - (item.from + item.durationInFrames)
			);
		}
	}
	const availableBefore = sourceFramesToTimelineFrames(item.sourceStart ?? 0, item, fps);
	const availableAfter =
		item.sourceEnd !== undefined && item.sourceDuration !== undefined
			? sourceFramesToTimelineFrames(item.sourceDuration - item.sourceEnd, item, fps)
			: requestedAfter;
	return {
		beforeFrames: Math.max(0, Math.min(requestedBefore, availableBefore)),
		afterFrames: Math.max(0, Math.min(requestedAfter, availableAfter))
	};
}

export function transitionGainSpansForItem(
	item: TimelineItem,
	transitions: TimelineTransition[],
	itemsById: Map<string, TimelineItem>,
	fps: number
): TransitionGainSpan[] {
	const spans: TransitionGainSpan[] = [];
	const seen = new Set<string>();
	for (const transition of transitions) {
		const from = itemsById.get(transition.fromItemId);
		const to = itemsById.get(transition.toItemId);
		if (!from || !to) continue;
		const window = resolveTransitionWindow(transition, from, to);
		if (!window) continue;
		const isOutgoing = isOutgoingTransitionParticipant(item, transition, itemsById);
		const isIncoming = isIncomingTransitionParticipant(item, transition, itemsById);
		if (!isOutgoing && !isIncoming) continue;
		const span = {
			startSeconds: window.startFrame / fps,
			durationSeconds: window.durationInFrames / fps,
			isIncoming,
			dipToSilence:
				transition.type === 'fade-black' || transition.presentation === 'dipToColorDissolve'
		};
		const key = `${span.startSeconds}:${span.durationSeconds}:${span.isIncoming}:${span.dipToSilence}`;
		if (seen.has(key)) continue;
		seen.add(key);
		spans.push(span);
	}
	return spans.sort((left, right) => left.startSeconds - right.startSeconds);
}

export function isAudioTransitionParticipantAtFrame(
	item: TimelineItem,
	frame: number,
	transitions: TimelineTransition[],
	itemsById: Map<string, TimelineItem>,
	fps: number
): boolean {
	const extent = transitionAudioExtentForItem(item, transitions, itemsById, fps);
	return (
		frame >= item.from - extent.beforeFrames &&
		frame < item.from + item.durationInFrames + extent.afterFrames
	);
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
	const seen = new Set<string>();
	for (const transition of transitions) {
		const from = itemsById.get(transition.fromItemId);
		const to = itemsById.get(transition.toItemId);
		if (!from || !to) continue;
		const window = resolveTransitionWindow(transition, from, to);
		if (!window || frame < window.startFrame || frame >= window.endFrame) continue;

		const progress = windowProgress(window, frame);
		const isOutgoing = isOutgoingTransitionParticipant(item, transition, itemsById);
		const isIncoming = isIncomingTransitionParticipant(item, transition, itemsById);
		if (!isOutgoing && !isIncoming) continue;
		const key = `${window.startFrame}:${window.endFrame}:${isIncoming}:${
			transition.type === 'fade-black' || transition.presentation === 'dipToColorDissolve'
		}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const localGain = transitionGainAtProgress(
			progress,
			isIncoming,
			transition.type === 'fade-black' || transition.presentation === 'dipToColorDissolve'
		);
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
