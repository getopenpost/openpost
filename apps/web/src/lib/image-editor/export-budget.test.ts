import { describe, expect, it } from 'vitest';
import { imageEditorExportBudget } from './export-budget';

describe('OpenPost Image Editor export budget', () => {
	it('allows ordinary multi-page social exports', () => {
		const pages = Array.from({ length: 10 }, (_, index) => ({
			id: `page-${index}`
		}));
		const budget = imageEditorExportBudget(
			{ width_px: 1080, height_px: 1080, pages },
			pages.map((page) => page.id)
		);
		expect(budget.allowed).toBe(true);
	});

	it('blocks exports whose retained output and canvas working set are unsafe', () => {
		const pages = Array.from({ length: 35 }, (_, index) => ({
			id: `page-${index}`
		}));
		const budget = imageEditorExportBudget(
			{ width_px: 8192, height_px: 8192, pages },
			pages.map((page) => page.id)
		);
		expect(budget.allowed).toBe(false);
	});

	it('budgets the selected page sizes when they differ from the document default', () => {
		const largePage = { id: 'large', width_px: 8192, height_px: 8192 };
		expect(
			imageEditorExportBudget({ width_px: 64, height_px: 64, pages: [largePage] }, ['large'])
				.allowed
		).toBe(false);
		const smallPage = { id: 'small', width_px: 64, height_px: 64 };
		expect(
			imageEditorExportBudget({ width_px: 8192, height_px: 8192, pages: [smallPage] }, ['small'])
				.allowed
		).toBe(true);
	});
});
