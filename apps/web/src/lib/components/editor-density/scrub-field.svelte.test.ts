import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';

function pressKey(element: Element | null, key: string): void {
	if (!(element instanceof HTMLElement)) throw new Error(`expected an HTMLElement for ${key}`);
	element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}
import ScrubField from './scrub-field.svelte';

describe('ScrubField keyboard', () => {
	it('nudges one step with arrow keys', async () => {
		const onValueChange = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Opacity',
			value: 20,
			min: 0,
			max: 100,
			step: 1,
			onValueChange
		});
		const input = screen.getByRole('textbox', { name: 'Opacity' });
		await expect.element(input).toBeVisible();
		await input.click();
		pressKey(input.element(), 'ArrowUp');
		expect(onValueChange).toHaveBeenLastCalledWith(21);
		pressKey(input.element(), 'ArrowDown');
		// Arrows walk from the live value: 20 up to 21, then back to 20.
		expect(onValueChange).toHaveBeenLastCalledWith(20);
	});

	it('commits typed text on Enter and reverts on Escape', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const onValueCancel = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Opacity',
			value: 20,
			min: 0,
			max: 100,
			step: 1,
			onValueChange,
			onValueCommit,
			onValueCancel
		});
		const input = screen.getByRole('textbox', { name: 'Opacity' });
		await expect.element(input).toBeVisible();
		await input.click();
		await input.clear();
		await input.fill('42');
		pressKey(input.element(), 'Enter');
		expect(onValueCommit).toHaveBeenCalledWith(42);

		await input.click();
		await input.clear();
		await input.fill('77');
		pressKey(input.element(), 'Escape');
		// Escape drops the draft and restores the committed value.
		expect(onValueChange).toHaveBeenLastCalledWith(20);
		expect(onValueCancel).toHaveBeenCalled();
	});
});
