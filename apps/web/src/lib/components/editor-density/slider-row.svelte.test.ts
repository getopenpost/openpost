import { describe, expect, it, vi } from 'vitest';
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
