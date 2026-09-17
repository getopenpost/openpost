import { describe, expect, it } from 'vitest';
import { sliderValueFromPointer } from './slider-track-math';

const GEOMETRY = { trackLeft: 100, trackWidth: 100, thumbWidthPx: 14 };

describe('sliderValueFromPointer', () => {
	it('lands the extremes exactly on the usable track ends', () => {
		const bounds = { min: 0, max: 100, step: 1 };
		// Far left of the usable area (track edge + half thumb) is exactly min.
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 100 }, bounds)).toBe(0);
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 107 }, bounds)).toBe(0);
		// Far right of the usable area is exactly max.
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 193 }, bounds)).toBe(100);
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 200 }, bounds)).toBe(100);
	});

	it('rides the thumb center under the cursor', () => {
		const bounds = { min: 0, max: 86, step: 1 };
		// Usable width is 86px, so 1px maps to 1 unit: center press maps to center value.
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 150 }, bounds)).toBe(43);
	});

	it('pins presses outside the track to the nearest end', () => {
		const bounds = { min: 10, max: 20, step: 1 };
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 0 }, bounds)).toBe(10);
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 1000 }, bounds)).toBe(20);
	});

	it('quantizes to step and clamps the result', () => {
		const bounds = { min: -180, max: 180, step: 1 };
		expect(sliderValueFromPointer({ ...GEOMETRY, clientX: 150.5, thumbWidthPx: 100 }, bounds)).toBe(
			0
		);
		// Degenerate track widths cannot divide by zero and pin to an end.
		expect(sliderValueFromPointer({ ...GEOMETRY, trackWidth: 10, clientX: 105 }, bounds)).toBe(
			-180
		);
	});
});
