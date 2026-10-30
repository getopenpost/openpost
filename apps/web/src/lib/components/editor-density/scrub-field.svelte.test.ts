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

	it('keeps negative and incomplete drafts editable without committing invalid text', async () => {
		const onbegin = vi.fn();
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const onValueCancel = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Exposure',
			value: 1,
			min: -5,
			max: 5,
			onbegin,
			onValueChange,
			onValueCommit,
			onValueCancel
		});
		const input = screen.getByRole('textbox', { name: 'Exposure' });
		await input.clear();
		await userEvent.type(input, '-');
		await expect.element(input).toHaveValue('-');
		expect(onValueChange).not.toHaveBeenCalled();
		await userEvent.type(input, '.5');
		await expect.element(input).toHaveValue('-.5');
		expect(onValueChange).toHaveBeenLastCalledWith(-0.5);
		expect(onbegin).toHaveBeenCalledOnce();
		await userEvent.keyboard('{Enter}');
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(-0.5);

		await input.clear();
		await userEvent.type(input, '-2');
		await userEvent.keyboard('{Backspace}');
		await expect.element(input).toHaveValue('-');
		await userEvent.keyboard('{Tab}');
		expect(onValueCommit).toHaveBeenCalledTimes(1);
		expect(onValueCancel).toHaveBeenCalledOnce();
		expect(onValueChange).toHaveBeenLastCalledWith(1);
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

	it('nudges from the current value when the typed draft is incomplete', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Pitch',
			value: 1,
			min: -5,
			max: 5,
			step: 1,
			onValueChange,
			onValueCommit
		});
		const input = screen.getByRole('textbox', { name: 'Pitch' });
		await input.clear();
		await userEvent.type(input, '-');
		await userEvent.keyboard('{ArrowUp}');
		expect(onValueChange).toHaveBeenLastCalledWith(2);
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(2);
	});

	it('supports page and boundary keys per the keyboard contract', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Opacity',
			value: 20,
			min: 0,
			max: 100,
			step: 1,
			onValueChange,
			onValueCommit
		});
		const input = screen.getByRole('textbox', { name: 'Opacity' });
		await expect.element(input).toBeVisible();
		await input.click();
		await userEvent.keyboard('{PageUp}');
		expect(onValueChange).toHaveBeenLastCalledWith(30);
		expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(30);
		await userEvent.keyboard('{End}');
		expect(onValueChange).toHaveBeenLastCalledWith(100);
		expect(onValueCommit).toHaveBeenLastCalledWith(100);
		await userEvent.keyboard('{Home}');
		expect(onValueChange).toHaveBeenLastCalledWith(0);
		expect(onValueCommit).toHaveBeenLastCalledWith(0);
	});

	it('commits a pointer scrub through the input', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(ScrubField, {
			ariaLabel: 'Position',
			value: 10,
			step: 1,
			onValueChange,
			onValueCommit
		});
		await expect.element(screen.getByRole('textbox', { name: 'Position' })).toBeVisible();
		const input = document.querySelector<HTMLInputElement>('input[aria-label="Position"]');
		if (!input) throw new Error('Expected the scrub field input');
		input.setPointerCapture = vi.fn();
		input.hasPointerCapture = vi.fn(() => false);
		await new Promise((resolve) => requestAnimationFrame(resolve));
		input.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 100 })
		);
		expect(input.setPointerCapture).toHaveBeenCalledWith(1);
		input.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: 140 })
		);
		input.dispatchEvent(
			new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 140 })
		);
		// 40px at 4px per step = 10 steps from the anchor pixel.
		expect(onValueChange).toHaveBeenCalledWith(20);
		expect(onValueCommit).toHaveBeenCalledWith(20);
	});
});
