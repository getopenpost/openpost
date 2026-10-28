import { describe, expect, it } from 'vitest';

import { fitKeyframeSpanToViewport } from './timeline-viewport';

describe('fitKeyframeSpanToViewport', () => {
	it('fits the frame span and never scrolls negative', () => {
		const { level, targetScrollLeft } = fitKeyframeSpanToViewport({
			frames: [0, 100],
			fallbackFrom: 0,
			fallbackTo: 199,
			fps: 30,
			availableWidth: 600,
			scrollBase: 0
		});
		expect(level).toBeCloseTo(600 / (101 * 4));
		expect(targetScrollLeft).toBe(0);
	});

	it('falls back to the full item range without frames', () => {
		const span = { fallbackFrom: 10, fallbackTo: 209, fps: 30, availableWidth: 800, scrollBase: 0 };
		const empty = fitKeyframeSpanToViewport({ ...span, frames: [] });
		const framed = fitKeyframeSpanToViewport({ ...span, frames: [10, 209] });
		expect(empty).toEqual(framed);
	});

	it('offsets scrolling by the scroll base', () => {
		const base = {
			frames: [0, 50],
			fallbackFrom: 0,
			fallbackTo: 199,
			fps: 30,
			availableWidth: 400
		};
		const without = fitKeyframeSpanToViewport({ ...base, scrollBase: 0 });
		const withBase = fitKeyframeSpanToViewport({ ...base, scrollBase: 120 });
		expect(without.targetScrollLeft).toBe(0);
		expect(withBase.targetScrollLeft).toBe(96);
		expect(withBase.level).toBe(without.level);
	});
});
