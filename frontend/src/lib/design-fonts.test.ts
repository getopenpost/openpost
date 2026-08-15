import { describe, expect, it } from 'vitest';
import { openPostDesignFonts } from './design-fonts';

describe('OpenPost design font catalog', () => {
	it('ships the complete shared font list in its stable display order', () => {
		expect(openPostDesignFonts.map((font) => font.label)).toEqual([
			'Geist',
			'Manrope',
			'DM Sans',
			'Space Grotesk',
			'Playfair Display',
			'Source Serif 4',
			'Arial',
			'Georgia',
			'Times New Roman',
			'Courier New'
		]);
	});

	it('keeps every font resolvable, categorised, and uniquely addressed', () => {
		const categories = new Set(['Sans serif', 'Serif', 'Monospace']);
		for (const font of openPostDesignFonts) {
			expect(font.family).toMatch(/[A-Za-z]/);
			expect(font.label.trim()).not.toBe('');
			expect(categories.has(font.category)).toBe(true);
		}
		expect(new Set(openPostDesignFonts.map((font) => font.family)).size).toBe(
			openPostDesignFonts.length
		);
	});
});
