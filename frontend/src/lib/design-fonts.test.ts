import { describe, expect, it } from 'vitest';
import { openPostDesignFonts } from './design-fonts';

describe('OpenPost design font catalog', () => {
	it('does not expose duplicate design families', () => {
		expect(new Set(openPostDesignFonts.map((font) => font.family)).size).toBe(
			openPostDesignFonts.length
		);
	});
});
