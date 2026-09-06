import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTransition } from '../project/types';
import {
	calculateTransitionPortions,
	calculateTransitionProgress,
	canPreserveTransition,
	getMaxTransitionDuration,
	resolveTransitionWindow
} from './transition-planner';

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'left',
		trackId: 'video',
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

const transition: TimelineTransition = {
	id: 'transition',
	type: 'crossfade',
	durationInFrames: 20,
	fromItemId: 'left',
	toItemId: 'right'
};

describe('transition planner', () => {
	it('centers odd and even durations without dropping a frame', () => {
		expect(calculateTransitionPortions(20, undefined)).toEqual({
			leftPortion: 10,
			rightPortion: 10
		});
		expect(calculateTransitionPortions(21, 0.5)).toEqual({
			leftPortion: 10,
			rightPortion: 11
		});
	});

	it('resolves a centered window across both sides of the cut', () => {
		const left = clip();
		const right = clip({ id: 'right', from: 60 });
		expect(resolveTransitionWindow(transition, left, right)).toEqual({
			startFrame: 50,
			endFrame: 70,
			durationInFrames: 20,
			leftPortion: 10,
			rightPortion: 10,
			cutFrame: 60
		});
	});

	it('requires enough hidden source on both sides of the cut', () => {
		const left = clip();
		const right = clip({ id: 'right', from: 60 });
		expect(canPreserveTransition(transition, left, right, 30, 0)).toBe(true);
		expect(canPreserveTransition(transition, left, { ...right, sourceStart: 5 }, 30, 0)).toBe(
			false
		);
		expect(canPreserveTransition(transition, { ...left, sourceEnd: 115 }, right, 30, 0)).toBe(
			false
		);
	});

	it('uses alignment to assign handle pressure', () => {
		const left = clip({ sourceEnd: 120 });
		const right = clip({ id: 'right', from: 60, sourceStart: 20 });
		expect(canPreserveTransition({ ...transition, alignment: 1 }, left, right, 30, 0)).toBe(true);
		expect(canPreserveTransition({ ...transition, alignment: 0 }, left, right, 30, 0)).toBe(false);
	});

	it('finds the exact duration ceiling for each placement', () => {
		const left = clip({ sourceEnd: 100 });
		const right = clip({ id: 'right', from: 60, sourceStart: 20 });
		expect(getMaxTransitionDuration(left, right, 0, 30)).toBe(20);
		expect(getMaxTransitionDuration(left, right, 0.5, 30)).toBe(40);
		expect(getMaxTransitionDuration(left, right, 1, 30)).toBe(20);
	});

	it('reaches exact endpoints and applies stored transition timing', () => {
		expect(calculateTransitionProgress(0, 30)).toBe(0);
		expect(calculateTransitionProgress(29, 30)).toBe(1);
		expect(calculateTransitionProgress(14.5, 30, 'ease-in')).toBe(0.25);
		expect(
			calculateTransitionProgress(14.5, 30, 'cubic-bezier', {
				x1: 0.42,
				y1: 0,
				x2: 0.58,
				y2: 1
			})
		).toBeCloseTo(0.5);
	});
});
