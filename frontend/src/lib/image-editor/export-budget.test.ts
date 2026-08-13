import { describe, expect, it } from 'vitest';
import { imageEditorExportBudget } from './export-budget';

describe('OpenPost Image Editor export budget', () => {
	it('allows ordinary multi-page social exports', () => {
		const pages = Array.from({ length: 10 }, (_, index) => ({ id: `page-${index}` }));
		const budget = imageEditorExportBudget(
			{ width_px: 1080, height_px: 1080, pages } as never,
			pages.map((page) => page.id)
		);
		expect(budget.allowed).toBe(true);
	});

	it('blocks exports whose retained output and canvas working set are unsafe', () => {
		const pages = Array.from({ length: 35 }, (_, index) => ({ id: `page-${index}` }));
		const budget = imageEditorExportBudget(
			{ width_px: 8192, height_px: 8192, pages } as never,
			pages.map((page) => page.id)
		);
		expect(budget.allowed).toBe(false);
	});
});
