import { describe, expect, it } from 'vitest';
import {
	clearTransitionHold,
	findTransitionHold,
	synchronizePausedTransitionMedia,
	TRANSITION_HOLD_SEEK_EPSILON_SECONDS
} from './transition-prearm';
import type { TimelineItem, TimelineTransition } from '../project/types';

function videoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'v1',
		trackId: 'track-1',
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 120,
		sourceDuration: 120,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

function transition(overrides: Partial<TimelineTransition> = {}): TimelineTransition {
	return {
		id: 't1',
		type: 'crossfade',
		durationInFrames: 20,
		alignment: 0.5,
		fromItemId: 'v1',
		toItemId: 'v2',
		...overrides
	};
}

function fakeVideo(currentTime = 0, paused = true): HTMLVideoElement {
	const dataset: Record<string, string> = {};
	const stub = {
		currentTime,
		paused,
		readyState: 1,
		playbackRate: 1,
		dataset,
		pause() {
			stub.paused = true;
		}
	};
	// SAFETY: synchronizePausedTransitionMedia only touches currentTime,
	// paused, readyState, playbackRate, dataset, and pause(), all present above.
	return stub as HTMLVideoElement;
}

describe('findTransitionHold', () => {
	const from = videoItem({ id: 'v1', from: 0, durationInFrames: 60 });
	const to = videoItem({ id: 'v2', from: 60, durationInFrames: 60 });
	const itemById = new Map([
		['v1', from],
		['v2', to]
	]);
	// 20-frame window centered on cut 60 → [50, 70).
	const transitions = [transition()];

	it('returns null outside the window', () => {
		expect(findTransitionHold({ itemId: 'v1', frame: 49, transitions, itemById })).toBeNull();
		expect(findTransitionHold({ itemId: 'v1', frame: 70, transitions, itemById })).toBeNull();
	});

	it('holds both participants inside the window with progress 0..1', () => {
		const outgoing = findTransitionHold({ itemId: 'v1', frame: 50, transitions, itemById });
		expect(outgoing).toMatchObject({ transitionId: 't1', outgoing: true, progress: 0 });
		const incoming = findTransitionHold({ itemId: 'v2', frame: 69, transitions, itemById });
		expect(incoming).toMatchObject({ transitionId: 't1', outgoing: false });
		expect(incoming?.progress).toBeGreaterThan(0.9);
	});

	it('ignores uninvolved items and missing partners', () => {
		expect(findTransitionHold({ itemId: 'v3', frame: 55, transitions, itemById })).toBeNull();
		expect(
			findTransitionHold({
				itemId: 'v1',
				frame: 55,
				transitions: [transition({ toItemId: 'missing' })],
				itemById
			})
		).toBeNull();
	});
});

describe('synchronizePausedTransitionMedia', () => {
	it('seeks only outside the 0.001s epsilon and flags the lane', () => {
		expect(TRANSITION_HOLD_SEEK_EPSILON_SECONDS).toBe(0.001);
		const held = fakeVideo(2.0);
		const settled = synchronizePausedTransitionMedia(held, 2.0005);
		expect(settled).toEqual({ held: true, seekIssued: false });
		expect(held.dataset.transitionHold).toBe('1');
		expect(held.dataset.transitionSourceRamp).toBe('1');

		const cold = fakeVideo(1.0, false);
		const moved = synchronizePausedTransitionMedia(cold, 2.0);
		expect(moved).toEqual({ held: false, seekIssued: true });
		expect(cold.currentTime).toBe(2.0);
		expect(cold.paused).toBe(true);
	});

	it('clears the ramp-owned flags', () => {
		const element = fakeVideo(2.0);
		synchronizePausedTransitionMedia(element, 2.0);
		clearTransitionHold(element);
		expect('transitionHold' in element.dataset).toBe(false);
		expect('transitionSourceRamp' in element.dataset).toBe(false);
	});
});
