import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StudioColorPicker from './studio-color-picker.svelte';

describe('StudioColorPicker', () => {
	it('keeps hex, HSL, and RGB drafts synchronized without falling back to black', async () => {
		const onChange = vi.fn();
		const screen = await render(StudioColorPicker, {
			label: 'Page background',
			value: '#1e1e1e',
			brandColors: [{ id: 'orange', name: 'OpenPost orange', value: '#ff8800' }],
			onChange
		});

		await screen.getByRole('button', { name: 'Page background' }).click();
		await screen.getByRole('button', { name: 'OpenPost orange: #ff8800' }).click();

		expect(onChange).toHaveBeenLastCalledWith('#ff8800');
		await expect.element(screen.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FF8800');

		await screen.getByRole('button', { name: 'rgb' }).click();
		const channelInputs = [
			...document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')
		];
		expect(channelInputs.map((input) => input.value)).toEqual(['255', '136', '0']);
		expect(onChange).not.toHaveBeenCalledWith('#000000');
	});
});
