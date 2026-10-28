import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AccountPickerSelectAll from './select-all.svelte';

describe('account-picker select-all header', () => {
	it('reports an indeterminate state when the selection is partial', async () => {
		const screen = await render(AccountPickerSelectAll, {
			selectedCount: 1,
			totalCount: 3,
			onSelectAll: vi.fn(),
			onClearAll: vi.fn()
		});

		const checkbox = screen.getByRole('checkbox', { name: 'Select all' });
		await expect.element(checkbox).toHaveAttribute('aria-checked', 'mixed');
		// The shared checkbox renders its distinct remove glyph for the partial state.
		await expect
			.element(
				screen.container.querySelector<SVGSVGElement>('[data-slot="checkbox-indicator"] svg')
			)
			.toBeVisible();
	});

	it('reports a checked state and clears on toggle when everything is selected', async () => {
		const onClearAll = vi.fn();
		const screen = await render(AccountPickerSelectAll, {
			selectedCount: 3,
			totalCount: 3,
			onSelectAll: vi.fn(),
			onClearAll
		});

		const checkbox = screen.getByRole('checkbox', { name: 'Select all' });
		await expect.element(checkbox).toBeChecked();

		await checkbox.click();
		expect(onClearAll).toHaveBeenCalledTimes(1);
	});

	it('selects all on toggle when the selection is partial', async () => {
		const onSelectAll = vi.fn();
		const screen = await render(AccountPickerSelectAll, {
			selectedCount: 1,
			totalCount: 3,
			onSelectAll,
			onClearAll: vi.fn()
		});

		await screen.getByRole('checkbox', { name: 'Select all' }).click();
		expect(onSelectAll).toHaveBeenCalledTimes(1);
	});
});
