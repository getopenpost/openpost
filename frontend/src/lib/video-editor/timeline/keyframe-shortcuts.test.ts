import { describe, expect, it } from 'vitest';
import type { EditorKeyframe } from './keyframe-editor';
import { adjacentKeyframe } from './keyframe-shortcuts';

function keyframe(frame: number): EditorKeyframe {
	return {
		property: 'opacity',
		frame,
		value: frame / 10,
		easing: 'linear'
	};
}

describe('keyframe shortcuts', () => {
	it('finds strict previous and next keys from an unsorted active property', () => {
		const keyframes = [keyframe(30), keyframe(0), keyframe(59)];
		expect(adjacentKeyframe(keyframes, 30, 'previous')?.frame).toBe(0);
		expect(adjacentKeyframe(keyframes, 30, 'next')?.frame).toBe(59);
		expect(adjacentKeyframe(keyframes, 0, 'previous')).toBeUndefined();
		expect(adjacentKeyframe(keyframes, 59, 'next')).toBeUndefined();
	});
});
