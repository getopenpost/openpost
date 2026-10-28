import { describe, expect, it } from 'vitest';
import { panelSizeFromArrowKey, panelSizeFromPointerDelta } from './panel-resize';

describe('panel resizing', () => {
	it('moves each panel edge in the physical pointer direction', () => {
		// 300.6 + 24 = 324.6 rounds to 325, so fractional sizes normalize
		// through the same pointer adapter the panels use.
		expect(panelSizeFromPointerDelta(300.6, 'right', 24, 0, 200, 500)).toBe(325);
		expect(panelSizeFromPointerDelta(300, 'left', 24, 0, 200, 500)).toBe(276);
		expect(panelSizeFromPointerDelta(300, 'bottom', 0, 24, 200, 500)).toBe(324);
		expect(panelSizeFromPointerDelta(300, 'top', 0, 24, 200, 500)).toBe(276);
	});

	it('clamps pointer and keyboard resizing to the advertised range', () => {
		expect(panelSizeFromPointerDelta(300, 'right', 999, 0, 220, 420)).toBe(420);
		expect(panelSizeFromArrowKey(220, 'right', 'ArrowLeft', 220, 420)).toBe(220);
		expect(panelSizeFromArrowKey(420, 'left', 'ArrowLeft', 220, 420)).toBe(420);
	});

	it('ignores keys that do not move a separator', () => {
		expect(panelSizeFromArrowKey(300, 'right', 'Enter', 220, 420)).toBeNull();
		expect(panelSizeFromArrowKey(300, 'right', 'ArrowUp', 220, 420)).toBeNull();
		expect(panelSizeFromArrowKey(300, 'top', 'ArrowRight', 220, 420)).toBeNull();
	});
});
