import { describe, expect, it } from 'vitest';
import { focusCrop, safeFocusPoint } from './smart-framing';

describe('OpenPost Video Editor smart framing', () => {
	it('creates a deterministic crop around the requested focus point', () => {
		expect(focusCrop({ width: 1920, height: 1080 }, 9 / 16, 0.8, 0.5)).toEqual({
			x: 0.641796875,
			y: 0,
			width: 0.31640625,
			height: 1
		});
	});

	it('keeps portrait framing away from social UI safe areas', () => {
		expect(safeFocusPoint(9 / 16, 0.02, 0.98)).toEqual({ x: 0.18, y: 0.72 });
		expect(safeFocusPoint(16 / 9, 0.02, 0.98)).toEqual({ x: 0.12, y: 0.86 });
	});
});
