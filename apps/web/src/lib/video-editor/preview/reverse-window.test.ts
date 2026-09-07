import { describe, expect, it } from 'vitest';
import {
	resolveReversePlaybackWindowPlan,
	shouldQueueReversePlaybackWindow
} from './reverse-window';

describe('resolveReversePlaybackWindowPlan', () => {
	it('strides by rate*fps/60 with a 20-sample window', () => {
		// 4x shuttle at 30fps → stride 2, 20 targets descending from 100.
		const plan = resolveReversePlaybackWindowPlan({
			targetFrame: 100,
			fps: 30,
			playbackRate: -4
		});
		expect(plan.strideFrames).toBe(2);
		expect(plan.targetFrames).toHaveLength(20);
		expect(plan.targetFrames[0]).toBe(100);
		expect(plan.highFrame).toBe(100);
		expect(plan.lowFrame).toBe(62);
		// Refill after ~60% of the 38-frame span is consumed.
		expect(plan.refillFrame).toBe(100 - Math.round(38 * 0.6));
	});

	it('uses stride 1 at 1x and clamps at zero', () => {
		const plan = resolveReversePlaybackWindowPlan({
			targetFrame: 5,
			fps: 30,
			playbackRate: -1
		});
		expect(plan.strideFrames).toBe(1);
		expect(plan.targetFrames).toEqual([5, 4, 3, 2, 1, 0]);
		expect(plan.lowFrame).toBe(0);
	});
});

describe('shouldQueueReversePlaybackWindow', () => {
	it('queues on empty window, outside coverage, or refill crossing', () => {
		const empty = {
			targetFrame: 90,
			preparedLowFrame: null,
			preparedHighFrame: null,
			refillFrame: null,
			requestInFlight: false
		};
		expect(shouldQueueReversePlaybackWindow(empty)).toBe(true);
		expect(
			shouldQueueReversePlaybackWindow({
				...empty,
				preparedLowFrame: 62,
				preparedHighFrame: 100,
				refillFrame: 77,
				targetFrame: 101
			})
		).toBe(true);
		expect(
			shouldQueueReversePlaybackWindow({
				...empty,
				preparedLowFrame: 62,
				preparedHighFrame: 100,
				refillFrame: 77,
				targetFrame: 77
			})
		).toBe(true);
	});

	it('holds inside coverage above refill and while a request is in flight', () => {
		const covered = {
			preparedLowFrame: 62,
			preparedHighFrame: 100,
			refillFrame: 77,
			requestInFlight: false
		};
		expect(shouldQueueReversePlaybackWindow({ ...covered, targetFrame: 90 })).toBe(false);
		expect(
			shouldQueueReversePlaybackWindow({ ...covered, targetFrame: 90, requestInFlight: true })
		).toBe(false);
	});
});
