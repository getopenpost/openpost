import { describe, expect, it } from 'vitest';
import { openPostDesignFonts } from './design-fonts';

describe('OpenPost design font catalog', () => {
	it('offers the same bundled design families to every editor', () => {
		expect(openPostDesignFonts.map((font) => font.label)).toEqual(
			expect.arrayContaining([
				'Geist',
				'Manrope',
				'DM Sans',
				'Space Grotesk',
				'Playfair Display',
				'Source Serif 4'
			])
		);
		expect(new Set(openPostDesignFonts.map((font) => font.family)).size).toBe(
			openPostDesignFonts.length
		);
	});
});
