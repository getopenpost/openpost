import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Slider from './slider.svelte';

describe('Slider', () => {
	it('commits one keyboard gesture after all repeated arrow updates', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const onKeydown = vi.fn((event: KeyboardEvent) => event.stopPropagation());
		const onWindowKeydown = vi.fn();
		window.addEventListener('keydown', onWindowKeydown);
		const screen = await render(Slider, {
			value: 0,
			min: 0,
			max: 10,
			step: 1,
			ariaLabel: 'Precision value',
			onValueChange,
			onValueCommit,
			onKeydown
		});
		const thumb = screen.getByRole('slider', { name: 'Precision value' });
		thumb.element().focus();
		await userEvent.keyboard('{ArrowRight>4/}');

		await expect.element(thumb).toHaveAttribute('aria-valuenow', '4');
		expect(onValueChange).toHaveBeenCalledTimes(4);
		expect(onValueCommit).toHaveBeenCalledOnce();
		expect(onValueCommit).toHaveBeenCalledWith(4);
		expect(onKeydown).toHaveBeenCalledTimes(4);
		expect(onWindowKeydown).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onWindowKeydown);
	});

	it('cancels a pending keyboard gesture without a late commit', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const onValueCancel = vi.fn();
		const screen = await render(Slider, {
			value: 3,
			min: 0,
			max: 10,
			step: 1,
			ariaLabel: 'Cancelable value',
			onValueChange,
			onValueCommit,
			onValueCancel
		});
		const thumb = screen.getByRole('slider', { name: 'Cancelable value' }).element();
		thumb.focus();
		thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		thumb.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));

		expect(onValueChange).toHaveBeenCalledWith(4);
		expect(onValueCancel).toHaveBeenCalledOnce();
		expect(onValueCommit).not.toHaveBeenCalled();
	});
});
