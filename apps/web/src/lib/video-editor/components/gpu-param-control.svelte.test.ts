import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import GpuParamControl from './gpu-param-control.svelte';

it('starts from the saved value when a numeric parameter has a positive minimum', async () => {
	const oncommit = vi.fn();
	const screen = await render(GpuParamControl, {
		param: { name: 'colors', label: 'Colors', min: 1, max: 10, step: 1, default: 4 },
		value: 4,
		effectLabel: 'Warp',
		oncommit
	});
	const slider = screen.getByRole('slider', { name: 'Warp: Colors' });
	await expect.element(slider).toHaveAttribute('aria-valuenow', '4');
	expect(oncommit).not.toHaveBeenCalled();
	slider.element().focus();
	await userEvent.keyboard('{ArrowLeft}');
	await expect.element(slider).toHaveAttribute('aria-valuenow', '3');
	expect(oncommit).toHaveBeenCalledExactlyOnceWith(3);
	await screen.rerender({ value: 7 });
	await expect.element(slider).toHaveAttribute('aria-valuenow', '7');
});

it('keeps a decimal Width draft while previewing bounded values and commits it on Tab', async () => {
	const oncommit = vi.fn();
	const screen = await render(GpuParamControl, {
		param: { name: 'width', label: 'Width', min: 0.02, max: 1, step: 0.01, default: 0.5 },
		value: 0.5,
		effectLabel: 'Power Window',
		oncommit
	});
	const input = screen.getByRole('textbox', { name: 'Power Window: Width' });
	const slider = screen.getByRole('slider', { name: 'Power Window: Width' });
	await input.clear();
	await userEvent.type(input, '0');
	await expect.element(input).toHaveValue('0');
	await expect.element(slider).toHaveAttribute('aria-valuenow', '0.02');
	await userEvent.type(input, '.70');
	await expect.element(input).toHaveValue('0.70');
	await expect.element(slider).toHaveAttribute('aria-valuenow', '0.7');
	expect(oncommit).not.toHaveBeenCalled();
	await userEvent.keyboard('{Tab}');
	expect(oncommit).toHaveBeenCalledExactlyOnceWith(0.7);
	await screen.rerender({ value: 0.7 });
	await expect.element(input).toHaveValue('0.70');
});
