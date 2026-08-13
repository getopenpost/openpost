import { describe, expect, it } from 'vitest';
import { hexToRGB, hslToHex, normalizeHex, rgbToHSL, rgbToHex } from './color';

describe('OpenPost Image Editor color conversion', () => {
	it('normalizes shorthand colors', () => {
		expect(normalizeHex('#f80')).toBe('#ff8800');
		expect(normalizeHex('#bb567aff')).toBe('#bb567a');
		expect(normalizeHex('invalid', '#ffffff')).toBe('#ffffff');
	});

	it('round-trips RGB and HSL colors', () => {
		const rgb = hexToRGB('#f97316');
		const hsl = rgbToHSL(rgb);

		expect(rgbToHex(rgb)).toBe('#f97316');
		expect(hslToHex(hsl)).toBe('#f97316');
	});
});
