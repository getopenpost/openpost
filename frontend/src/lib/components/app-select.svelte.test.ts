import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AppSelect from './app-select.svelte';

describe('AppSelect', () => {
	it('uses the shared select primitive and reports string values', async () => {
		const onValueChange = vi.fn();
		const screen = await render(AppSelect, {
			value: 'png',
			ariaLabel: 'Export format',
			options: [
				{ value: 'png', label: 'PNG' },
				{ value: 'webp', label: 'WebP' }
			],
			onValueChange
		});

		const trigger = screen.getByRole('combobox', { name: 'Export format' });
		await expect.element(trigger).toHaveTextContent('PNG');
		await trigger.click();
		await screen.getByRole('option', { name: 'WebP' }).click();

		expect(onValueChange).toHaveBeenCalledOnce();
		expect(onValueChange).toHaveBeenCalledWith('webp');
		await expect.element(trigger).toHaveTextContent('WebP');
	});
});
