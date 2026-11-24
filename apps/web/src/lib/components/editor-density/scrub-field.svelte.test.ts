import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';

function pressKey(element: Element | null, key: string): void {
	if (!(element instanceof HTMLElement)) throw new Error(`expected an HTMLElement for ${key}`);
	element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}
import ScrubField from './scrub-field.svelte';

describe('ScrubField keyboard', () => {
	it('preserves a decimal draft below the minimum while typing, then commits on blur', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Width',
			value: 0.5,
			min: 0.02,
			max: 1,
			onValueChange,
			onValueCommit
		});
		const input = screen.getByRole('textbox', { name: 'Width' });
		await input.clear();
		await userEvent.type(input, '0');
		await expect.element(input).toHaveValue('0');
		expect(onValueChange).toHaveBeenLastCalledWith(0.02);
		await screen.rerender({ value: 0.02 });
		await expect.element(input).toHaveValue('0');
		await userEvent.type(input, '.70');
		await expect.element(input).toHaveValue('0.70');
		expect(onValueChange).toHaveBeenLastCalledWith(0.7);
		await screen.rerender({ value: 0.7 });
		await userEvent.keyboard('{Tab}');
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(0.7);
		await expect.element(input).toHaveValue('0.70');
	});

	it('clamps a complete out-of-range draft on commit and cancels an empty draft', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const onValueCancel = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Width',
			value: 0.5,
			min: 0.02,
			max: 1,
			onValueChange,
			onValueCommit,
			onValueCancel
		});
		const input = screen.getByRole('textbox', { name: 'Width' });
		await input.clear();
		await userEvent.type(input, '2.50');
		await expect.element(input).toHaveValue('2.50');
		expect(onValueChange).toHaveBeenLastCalledWith(1);
		await userEvent.keyboard('{Enter}');
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(1);

		await input.clear();
		await userEvent.keyboard('{Escape}');
		await expect.element(input).toHaveValue('0.50');
		expect(onValueCommit).toHaveBeenCalledTimes(1);
		expect(onValueCancel).toHaveBeenCalledOnce();
		expect(onValueChange).toHaveBeenLastCalledWith(0.5);
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

describe('ScrubField suffix', () => {
	it('keeps the unit outside the typed value and parses without it', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Duration',
			value: 12,
			min: 0,
			max: 100,
			step: 1,
			precision: 0,
			suffix: 's',
			ariaDescribedBy: 'external-hint',
			onValueChange,
			onValueCommit
		});
		const input = screen.getByRole('textbox', { name: 'Duration' });
		await expect.element(input).toHaveValue('12');
		await expect.element(screen.getByText('s')).toBeVisible();
		// The unit is announced alongside the caller's description, never typed.
		const described = input.element().getAttribute('aria-describedby');
		expect(described).toContain('external-hint');
		const ids = described!.split(/\s+/);
		expect(ids).toHaveLength(2);
		expect(document.getElementById(ids[0]!)?.textContent).toBe('s');
		await input.clear();
		await userEvent.type(input, '5');
		await expect.element(input).toHaveValue('5');
		expect(onValueChange).toHaveBeenLastCalledWith(5);
		await userEvent.keyboard('{Enter}');
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(5);
	});
});
