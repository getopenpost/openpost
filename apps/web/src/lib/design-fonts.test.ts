import { describe, expect, it } from 'vitest';
import { openPostDesignFonts } from './design-fonts';

describe('editor font catalog', () => {
	it('contains every bundled video font in the shared editor catalog', () => {
		const labels = new Set(openPostDesignFonts.map((font) => font.label));
		for (const label of [
			'Inter',
			'Inter Tight',
			'Roboto',
			'Roboto Slab',
			'Anton',
			'Bebas Neue',
			'Orbitron',
			'Playfair Display',
			'Space Grotesk',
			'Geist'
		]) {
			expect(labels.has(label), `missing ${label}`).toBe(true);
		}
	});
});
