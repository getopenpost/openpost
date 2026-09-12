import { describe, expect, it } from 'vitest';
import type { EditorKeyframe } from './keyframe-editor';
import { buildScaleRetimePreview, scaleRatioFromEdge } from './keyframe-scale-retime';

function keyframe(property: 'x' | 'opacity', frame: number, id: string): EditorKeyframe {
	return { property, frame, id, index: 0, value: 0, easing: 'linear' };
}

describe('buildScaleRetimePreview', () => {
	it('stretches a selection around the anchor frame', () => {
		const keyframes = [keyframe('x', 10, 'a'), keyframe('x', 20, 'b'), keyframe('x', 30, 'c')];
		const preview = buildScaleRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b', 'c']),
			lockedProperties: new Set(),
			anchorFrame: 10,
			requestedScale: 2,
			totalFrames: 100,
			blockedRanges: []
		});
		expect(preview.appliedScale).toBeCloseTo(2);
		expect(preview.frames.get('a')).toBe(10);
		expect(preview.frames.get('b')).toBe(30);
		expect(preview.frames.get('c')).toBe(50);
	});

	it('compresses a selection toward the anchor frame', () => {
		const keyframes = [keyframe('x', 0, 'a'), keyframe('x', 40, 'b')];
		const preview = buildScaleRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b']),
			lockedProperties: new Set(),
			anchorFrame: 0,
			requestedScale: 0.5,
			totalFrames: 100,
			blockedRanges: []
		});
		expect(preview.appliedScale).toBeCloseTo(0.5);
		expect(preview.frames.get('b')).toBe(20);
	});

	it('clamps growth at the clip end instead of overflowing', () => {
		const keyframes = [keyframe('x', 0, 'a'), keyframe('x', 40, 'b')];
		const preview = buildScaleRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b']),
			lockedProperties: new Set(),
			anchorFrame: 0,
			requestedScale: 10,
			totalFrames: 50,
			blockedRanges: []
		});
		expect(preview.appliedScale).toBeLessThan(10);
		expect(preview.frames.get('b')).toBeLessThanOrEqual(49);
	});

	it('keeps the minimum one-frame gap to unselected neighbors', () => {
		const keyframes = [keyframe('x', 10, 'a'), keyframe('x', 12, 'b'), keyframe('x', 13, 'c')];
		const preview = buildScaleRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b']),
			lockedProperties: new Set(),
			anchorFrame: 10,
			requestedScale: 3,
			totalFrames: 100,
			blockedRanges: []
		});
		const b = preview.frames.get('b') ?? 0;
		expect(b).toBeLessThan(13);
		expect(b).toBeGreaterThan(10);
	});

	it('rejects frames that land inside blocked ranges', () => {
		const keyframes = [keyframe('x', 0, 'a'), keyframe('x', 10, 'b')];
		const preview = buildScaleRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b']),
			lockedProperties: new Set(),
			anchorFrame: 0,
			requestedScale: 2,
			totalFrames: 100,
			blockedRanges: [{ start: 20, end: 30 }]
		});
		expect(preview.frames.get('b')).not.toBe(20);
	});

	it('returns an empty preview for identity scales and invalid input', () => {
		const keyframes = [keyframe('x', 10, 'a')];
		const base = {
			keyframes,
			selectionIds: new Set(['a']),
			lockedProperties: new Set<EditorKeyframe['property']>(),
			anchorFrame: 10,
			totalFrames: 100,
			blockedRanges: []
		};
		expect(buildScaleRetimePreview({ ...base, requestedScale: 1 }).frames.size).toBe(0);
		expect(buildScaleRetimePreview({ ...base, requestedScale: 0 }).frames.size).toBe(0);
		expect(buildScaleRetimePreview({ ...base, requestedScale: NaN }).frames.size).toBe(0);
	});

	describe('scaleRatioFromEdge', () => {
		it('measures growth against the held anchor edge', () => {
			expect(scaleRatioFromEdge({ anchorFrame: 10, farFrame: 30, farFrameNew: 50 })).toBeCloseTo(2);
		});

		it('measures compression when the dragged edge moves toward the anchor', () => {
			expect(scaleRatioFromEdge({ anchorFrame: 30, farFrame: 10, farFrameNew: 20 })).toBeCloseTo(
				0.5
			);
		});

		it('returns identity for degenerate or inverted drags', () => {
			expect(scaleRatioFromEdge({ anchorFrame: 10, farFrame: 10, farFrameNew: 40 })).toBe(1);
			expect(scaleRatioFromEdge({ anchorFrame: 10, farFrame: 30, farFrameNew: 10 })).toBe(1);
			expect(scaleRatioFromEdge({ anchorFrame: 10, farFrame: 30, farFrameNew: Number.NaN })).toBe(
				1
			);
		});
	});

	it('skips locked properties', () => {
		const keyframes = [keyframe('x', 0, 'a'), keyframe('opacity', 10, 'b')];
		const preview = buildScaleRetimePreview({
			keyframes,
			selectionIds: new Set(['a', 'b']),
			lockedProperties: new Set(['opacity' as const]),
			anchorFrame: 0,
			requestedScale: 2,
			totalFrames: 100,
			blockedRanges: []
		});
		expect(preview.frames.get('a')).toBe(0);
		expect(preview.frames.has('b')).toBe(false);
	});
});
