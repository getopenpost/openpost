import { describe, expect, it } from 'vitest';
import { clampMediaPage } from './media-pagination';

describe('media pagination', () => {
	it('moves back when deletion removes the current last page', () => {
		expect(clampMediaPage(1, 40, 40)).toBe(0);
		expect(clampMediaPage(2, 80, 40)).toBe(1);
	});

	it('keeps a valid page and handles an empty library', () => {
		expect(clampMediaPage(1, 81, 40)).toBe(1);
		expect(clampMediaPage(3, 0, 40)).toBe(0);
	});
});
