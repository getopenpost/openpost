import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import SliderRow from './slider-row.svelte';

describe('SliderRow track gestures', () => {
	it('lands the value where the track is pressed', async () => {
		let landed = NaN;
		const screen = await render(SliderRow, {
			label: 'Opacity',
			value: 20,
			min: 0,
			max: 100,
			step: 1,
			onValueChange: (next) => {
				landed = next;
			}
		});
		const group = screen.getByRole('group', { name: 'Opacity' });
		await expect.element(group).toBeVisible();
		const track = group.element().querySelector('[data-slot="slider-track"]');
		if (!(track instanceof HTMLElement)) throw new Error('expected a rendered slider track');
		const groupBounds = group.element().getBoundingClientRect();
		const trackBounds = track.getBoundingClientRect();
		// The thumb centre rides under the pointer, so the rendered track centre is
		// 50% of the 0-100 range at any thumb width.
		await group.click({
			position: {
				x: trackBounds.left - groupBounds.left + trackBounds.width / 2,
				y: trackBounds.top - groupBounds.top + trackBounds.height / 2
			}
		});
		expect(landed).toBe(50);
	});

	it('ignores track presses while disabled', async () => {
		const onValueChange = vi.fn();
		const screen = await render(SliderRow, {
			label: 'Opacity',
			value: 20,
			min: 0,
			max: 100,
			step: 1,
			disabled: true,
			onValueChange
		});
		const group = screen.getByRole('group', { name: 'Opacity' });
		await expect.element(group).toBeVisible();
		const box = group.element().getBoundingClientRect();
		await group.click({ position: { x: box.width * 0.8, y: box.height / 2 } });
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it('commits the reset value on double click', async () => {
		const onValueCommit = vi.fn();
		const screen = await render(SliderRow, {
			label: 'Opacity',
			value: 80,
			min: 0,
			max: 100,
			step: 1,
			resetValue: 100,
			onValueCommit
		});
		const group = screen.getByRole('group', { name: 'Opacity' });
		await expect.element(group).toBeVisible();
		const groupElement = group.element();
		if (!(groupElement instanceof HTMLElement)) throw new Error('expected an HTMLElement group');
		groupElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(onValueCommit).toHaveBeenCalledWith(100);
	});
});

describe('SliderRow absorbed editor-color-slider capabilities', () => {
	it('scales the displayed value and converts commits back to model units', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(SliderRow, {
			label: 'Brightness',
			value: 0.5,
			min: -1,
			max: 1,
			step: 0.01,
			precision: 0,
			displayScale: 100,
			onValueChange,
			onValueCommit
		});
		const input = screen.getByRole('textbox', { name: 'Brightness' });
		await expect.element(input).toHaveValue('50');
		const slider = screen.getByRole('slider', { name: 'Brightness' });
		await expect.element(slider).toHaveAttribute('aria-valuetext', '50');
		await input.clear();
		await userEvent.type(input, '60');
		expect(onValueChange).toHaveBeenLastCalledWith(0.6);
		await userEvent.keyboard('{Enter}');
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(0.6);
	});

	it('shows the unit beside the value and announces it on the thumb', async () => {
		const screen = await render(SliderRow, {
			label: 'Duration',
			value: 12,
			min: 0,
			max: 100,
			step: 1,
			precision: 0,
			suffix: 'frames'
		});
		const input = screen.getByRole('textbox', { name: 'Duration' });
		await expect.element(input).toHaveValue('12');
		await expect.element(screen.getByText('frames')).toBeVisible();
		const slider = screen.getByRole('slider', { name: 'Duration' });
		await expect.element(slider).toHaveAttribute('aria-valuetext', '12 frames');
	});

	it('renders the reset button only when labelled and commits the reset value', async () => {
		const onbegin = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(SliderRow, {
			label: 'Opacity',
			value: 80,
			min: 0,
			max: 100,
			step: 1,
			resetValue: 100,
			resetLabel: 'Reset',
			onbegin,
			onValueCommit
		});
		const reset = screen.getByRole('button', { name: 'Reset: Opacity' });
		await expect.element(reset).toBeEnabled();
		await reset.click();
		expect(onbegin).toHaveBeenCalledOnce();
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(100);
		await screen.rerender({ value: 100 });
		await expect.element(reset).toBeDisabled();
	});

	it('shows the mixed placeholder while the value is null', async () => {
		const screen = await render(SliderRow, {
			label: 'Brightness',
			value: null,
			min: -1,
			max: 1,
			step: 0.01,
			precision: 0,
			displayScale: 100,
			resetValue: 0,
			placeholder: 'Mixed values'
		});
		const input = screen.getByRole('textbox', { name: 'Brightness' });
		await expect.element(input).toHaveValue('');
		await expect.element(input).toHaveAttribute('placeholder', 'Mixed values');
	});
});
