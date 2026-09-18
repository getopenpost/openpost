import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import SliderRow from './slider-row.svelte';

describe('SliderRow track gestures', () => {
	it('lands the value where the track is pressed', async () => {
		const onValueChange = vi.fn();
		const screen = await render(SliderRow, {
			label: 'Opacity',
			value: 20,
			min: 0,
			max: 100,
			step: 1,
			onValueChange
		});
		const group = screen.getByRole('group', { name: 'Opacity' });
		await expect.element(group).toBeVisible();
		const box = group.element().getBoundingClientRect();
		// Press well right of the thumb (value 20 sits near the left end).
		await group.click({ position: { x: box.width * 0.8, y: box.height / 2 } });
		expect(onValueChange).toHaveBeenCalled();
		const landed = onValueChange.mock.calls.at(-1)?.[0] as number;
		expect(Number.isFinite(landed)).toBe(true);
		expect(landed).toBeGreaterThan(20);
		expect(landed).toBeLessThanOrEqual(100);
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
		(group.element() as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(onValueCommit).toHaveBeenCalledWith(100);
	});
});
