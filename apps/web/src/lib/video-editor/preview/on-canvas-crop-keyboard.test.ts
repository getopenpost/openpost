import { describe, expect, it } from 'vitest';
import { calculateCropFromDrag, nextCropKeyboardLocal } from './on-canvas-tools';

describe('nextCropKeyboardLocal', () => {
	it('nudges one local pixel with arrows and ten with shift', () => {
		expect(nextCropKeyboardLocal('left', 'ArrowRight', false)).toEqual({ x: 1, y: 0 });
		expect(nextCropKeyboardLocal('left', 'ArrowLeft', false)).toEqual({ x: -1, y: 0 });
		expect(nextCropKeyboardLocal('left', 'ArrowRight', true)).toEqual({ x: 10, y: 0 });
		expect(nextCropKeyboardLocal('right', 'ArrowLeft', false)).toEqual({ x: -1, y: 0 });
		expect(nextCropKeyboardLocal('right', 'ArrowRight', false)).toEqual({ x: 1, y: 0 });
		expect(nextCropKeyboardLocal('top', 'ArrowDown', false)).toEqual({ x: 0, y: 1 });
		expect(nextCropKeyboardLocal('top', 'ArrowUp', false)).toEqual({ x: 0, y: -1 });
		expect(nextCropKeyboardLocal('bottom', 'ArrowUp', false)).toEqual({ x: 0, y: -1 });
		expect(nextCropKeyboardLocal('bottom', 'ArrowDown', false)).toEqual({ x: 0, y: 1 });
	});

	it('takes large inward and outward steps with PageUp and PageDown', () => {
		expect(nextCropKeyboardLocal('left', 'PageUp', false)).toEqual({ x: 10, y: 0 });
		expect(nextCropKeyboardLocal('left', 'PageDown', false)).toEqual({ x: -10, y: 0 });
		expect(nextCropKeyboardLocal('right', 'PageUp', false)).toEqual({ x: -10, y: 0 });
		expect(nextCropKeyboardLocal('top', 'PageUp', false)).toEqual({ x: 0, y: 10 });
		expect(nextCropKeyboardLocal('bottom', 'PageDown', false)).toEqual({ x: 0, y: 10 });
	});

	it('lands on the no-crop and maximum-crop bounds with Home and End', () => {
		const home = nextCropKeyboardLocal('left', 'Home', false);
		const end = nextCropKeyboardLocal('left', 'End', false);
		expect(home?.x).toBeLessThan(0);
		expect(end?.x).toBeGreaterThan(0);
		const base = {
			edge: 'left' as const,
			startPoint: { x: 0, y: 0 },
			rotation: 0,
			mediaWidth: 100,
			mediaHeight: 50,
			sourceDimension: 400
		};
		const cleared = calculateCropFromDrag({
			...base,
			startCrop: { left: 0.5, right: 0, top: 0, bottom: 0 },
			currentPoint: home ?? { x: 0, y: 0 }
		});
		expect(cleared.left).toBe(0);
		const maxed = calculateCropFromDrag({
			...base,
			startCrop: { left: 0.5, right: 0, top: 0, bottom: 0 },
			currentPoint: end ?? { x: 0, y: 0 }
		});
		expect(maxed.left).toBe(399 / 400);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextCropKeyboardLocal('left', 'Enter', false)).toBeNull();
		expect(nextCropKeyboardLocal('left', 'a', false)).toBeNull();
	});
});
