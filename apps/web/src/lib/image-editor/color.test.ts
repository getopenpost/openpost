import { describe, expect, it } from 'vitest';
import { normalizeHex } from './color';

describe('OpenPost Image Editor color conversion', () => {
	it('normalizes shorthand colors', () => {
		expect(normalizeHex('#f80')).toBe('#ff8800');
		expect(normalizeHex('#bb567aff')).toBe('#bb567a');
		expect(normalizeHex('invalid', '#ffffff')).toBe('#ffffff');
	});
});
