import { describe, expect, it } from 'vitest';
import type { EditorKeyframe } from './keyframe-editor';
import { buildScaleRetimePreview } from './keyframe-scale-retime';

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
		expect(preview.frames.get('b')).toBe(19);
	});
});
