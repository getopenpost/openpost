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
