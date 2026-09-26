import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import '../../../routes/layout.css';
import Knob from './knob.svelte';

async function renderKnob(props: Record<string, unknown> = {}) {
	const screen = await render(Knob, {
		ariaLabel: 'Opacity',
		value: 50,
		min: 0,
		max: 100,
		step: 1,
		...props
	});
	const slider = screen.getByRole('slider', { name: 'Opacity' });
	await expect.element(slider).toBeVisible();
	(slider.element() as HTMLElement).focus();
	await expect.element(slider).toHaveFocus();
	return { screen, slider };
}

describe('Knob slider keyboard', () => {
	it('jumps to min and max with Home and End', async () => {
		const onValueChange = vi.fn();
		const { slider } = await renderKnob({ onValueChange });
		await userEvent.keyboard('{Home}');
		expect(onValueChange).toHaveBeenCalledWith(0);
		onValueChange.mockClear();
		await userEvent.keyboard('{End}');
		expect(onValueChange).toHaveBeenCalledWith(100);
	});

	it('moves in large steps with PageUp and PageDown', async () => {
		const onValueChange = vi.fn();
		const { slider } = await renderKnob({ onValueChange });
		await userEvent.keyboard('{PageUp}');
		expect(onValueChange).toHaveBeenCalledWith(60);
		onValueChange.mockClear();
		await userEvent.keyboard('{PageDown}');
		expect(onValueChange).toHaveBeenCalledWith(40);
	});

	it('ignores extended keys while disabled', async () => {
		const onValueChange = vi.fn();
		await renderKnob({ disabled: true, onValueChange });
		await userEvent.keyboard('{Home}{End}{PageUp}{PageDown}');
		expect(onValueChange).not.toHaveBeenCalled();
	});
});
