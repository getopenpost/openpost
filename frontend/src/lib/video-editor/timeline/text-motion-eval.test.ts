import { describe, expect, it } from 'vitest';
import type { TextMotionSpec } from '../project/types';
import { evaluateGlyphMotion, getActiveTextMotionSlot } from './text-motion-eval';
import { createTextMotionEffect } from './text-motion-presets';

function context(relativeFrame: number, unitIndex = 0, unitCount = 4) {
	return {
		relativeFrame,
		durationInFrames: 60,
		unitIndex,
		unitCount,
		fontSize: 40,
		boxWidth: 400,
		boxHeight: 200
	};
}

describe('text motion evaluator', () => {
	it('stagger-reveals characters with the exact typewriter step', () => {
		const spec: TextMotionSpec = { in: createTextMotionEffect('typewriter') };
		expect(evaluateGlyphMotion(spec, context(0, 0))).toMatchObject({ alpha: 0 });
		expect(evaluateGlyphMotion(spec, context(1, 0))).toBeNull();
		expect(evaluateGlyphMotion(spec, context(1, 1))).toMatchObject({ alpha: 0 });
		expect(evaluateGlyphMotion(spec, context(3, 1))).toBeNull();
	});

	it('compresses long stagger windows into half of a short clip', () => {
		const spec: TextMotionSpec = { in: createTextMotionEffect('typewriter') };
		const short = { ...context(4.9, 3), durationInFrames: 10 };
		expect(evaluateGlyphMotion(spec, short)).toMatchObject({ alpha: 0 });
		expect(evaluateGlyphMotion(spec, { ...short, relativeFrame: 5 })).toBeNull();
	});

	it('gives the out slot priority where one-shot windows meet', () => {
		const spec: TextMotionSpec = {
			in: { ...createTextMotionEffect('fade-up'), durationFrames: 30, staggerFrames: 0 },
			out: { ...createTextMotionEffect('fade-down'), durationFrames: 30, staggerFrames: 0 }
		};
		expect(getActiveTextMotionSlot(spec, 29.99, 60)).toBe('in');
		expect(getActiveTextMotionSlot(spec, 30, 60)).toBe('out');
		expect(evaluateGlyphMotion(spec, context(30))).toBeNull();
	});

	it('loops continuously after the entrance window', () => {
		const spec: TextMotionSpec = { loop: createTextMotionEffect('pulse') };
		expect(evaluateGlyphMotion(spec, context(0))).toBeNull();
		expect(evaluateGlyphMotion(spec, context(9))).toMatchObject({ scale: 1.06 });
	});

	it('keeps random order deterministic for a stable seed', () => {
		const spec: TextMotionSpec = {
			in: { ...createTextMotionEffect('typewriter', 42), order: 'random' }
		};
		const first = [0, 1, 2, 3].map((index) => evaluateGlyphMotion(spec, context(2, index)));
		const second = [0, 1, 2, 3].map((index) => evaluateGlyphMotion(spec, context(2, index)));
		expect(second).toEqual(first);
		expect(new Set(first.map((state) => state?.alpha ?? 1)).size).toBeGreaterThan(1);
	});

	it('supports center-out and backward stagger ranks', () => {
		const center: TextMotionSpec = {
			in: { ...createTextMotionEffect('typewriter'), order: 'center' }
		};
		expect(evaluateGlyphMotion(center, context(1, 1, 5))).toMatchObject({ alpha: 0 });
		expect(evaluateGlyphMotion(center, context(1, 2, 5))).toBeNull();
		expect(evaluateGlyphMotion(center, context(1, 0, 5))).toMatchObject({ alpha: 0 });
		const backward: TextMotionSpec = {
			in: { ...createTextMotionEffect('typewriter'), order: 'backward' }
		};
		expect(evaluateGlyphMotion(backward, context(1, 3))).toBeNull();
		expect(evaluateGlyphMotion(backward, context(1, 0))).toMatchObject({ alpha: 0 });
	});

	it('respects entrance and exit edge offsets', () => {
		const spec: TextMotionSpec = {
			in: { ...createTextMotionEffect('typewriter'), offsetFrames: 5, staggerFrames: 0 },
			out: { ...createTextMotionEffect('typewriter-erase'), offsetFrames: 5, staggerFrames: 0 }
		};
		expect(evaluateGlyphMotion(spec, context(4))).toMatchObject({ alpha: 0 });
		expect(evaluateGlyphMotion(spec, context(5))).toMatchObject({ alpha: 0 });
		expect(getActiveTextMotionSlot(spec, 54, 60)).toBe('out');
		expect(getActiveTextMotionSlot(spec, 59, 60)).toBe('out');
		expect(evaluateGlyphMotion(spec, context(55))).toMatchObject({ alpha: 0 });
	});

	it('phase-staggers loop units and clamps intensity to the supported range', () => {
		const wave: TextMotionSpec = {
			loop: { ...createTextMotionEffect('wave'), intensity: 10 }
		};
		const first = evaluateGlyphMotion(wave, context(8, 0));
		const second = evaluateGlyphMotion(wave, context(8, 1));
		expect(first?.dy).not.toBe(second?.dy);
		expect(Math.abs(first?.dy ?? 0)).toBeLessThanOrEqual(16);
	});

	it('returns the identity fast path for empty and zero-duration specs', () => {
		expect(evaluateGlyphMotion({}, context(0))).toBeNull();
		expect(
			evaluateGlyphMotion(
				{ in: createTextMotionEffect('rise') },
				{ ...context(0), durationInFrames: 0 }
			)
		).toBeNull();
	});
});
