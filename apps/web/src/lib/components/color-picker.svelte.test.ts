import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ColorPicker from './color-picker.svelte';
import '../../routes/layout.css';

describe('shared color picker', () => {
	it('offers brand colors and commits a preset without the browser picker', async () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const screen = await render(ColorPicker, {
			label: 'Fill color',
			value: '#112233',
			live: false,
			brandColors: [{ id: 'brand-orange', name: 'Brand orange', value: '#b74c05' }],
			onChange,
			onCommit
		});

		await screen.getByRole('button', { name: 'Fill color' }).click();
		const brandColor = screen.getByRole('button', { name: 'Brand orange: #b74c05' });
		await expect.element(brandColor).toHaveAttribute('aria-pressed', 'false');
		await brandColor.click();

		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith('#b74c05');
		expect(onCommit).toHaveBeenCalledWith('#b74c05');
	});
});
