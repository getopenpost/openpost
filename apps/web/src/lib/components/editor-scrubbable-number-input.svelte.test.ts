import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import EditorScrubbableNumberInput from './editor-scrubbable-number-input.svelte';

it('nudges from the current value when the typed draft is incomplete', async () => {
	const onlive = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(EditorScrubbableNumberInput, {
		ariaLabel: 'Pitch',
		value: 1,
		min: -5,
		max: 5,
		step: 1,
		onlive,
		oncommit
	});
	const input = screen.getByRole('textbox', { name: 'Pitch' });
	await input.clear();
	await userEvent.type(input, '-');
	await userEvent.keyboard('{ArrowUp}');
	expect(onlive).toHaveBeenLastCalledWith(2);
	expect(oncommit).toHaveBeenCalledExactlyOnceWith(2);
});

it('keeps a typed decimal draft while emitting bounded previews and commits on blur', async () => {
	const onlive = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(EditorScrubbableNumberInput, {
		ariaLabel: 'Width',
		value: 0.5,
		min: 0.02,
		max: 1,
		onlive,
		oncommit
	});
	const input = screen.getByRole('textbox', { name: 'Width' });
	await input.clear();
	await userEvent.type(input, '0');
	await expect.element(input).toHaveValue('0');
	expect(onlive).toHaveBeenLastCalledWith(0.02);
	await screen.rerender({ value: 0.02 });
	await userEvent.type(input, '.70');
	await expect.element(input).toHaveValue('0.70');
	expect(onlive).toHaveBeenLastCalledWith(0.7);
	await screen.rerender({ value: 0.7 });
	await userEvent.keyboard('{Tab}');
	expect(oncommit).toHaveBeenCalledExactlyOnceWith(0.7);
	await expect.element(input).toHaveValue('0.70');
});

it('allows incomplete negative text and backspace, then cancels invalid text', async () => {
	const onlive = vi.fn();
	const oncommit = vi.fn();
	const oncancel = vi.fn();
	const screen = await render(EditorScrubbableNumberInput, {
		ariaLabel: 'Pitch',
		value: 1,
		min: -5,
		max: 5,
		onlive,
		oncommit,
		oncancel
	});
	const input = screen.getByRole('textbox', { name: 'Pitch' });
	await input.clear();
	await userEvent.type(input, '-');
	await expect.element(input).toHaveValue('-');
	expect(onlive).not.toHaveBeenCalled();
	await userEvent.type(input, '.5');
	await expect.element(input).toHaveValue('-.5');
	expect(onlive).toHaveBeenLastCalledWith(-0.5);
	await userEvent.keyboard('{Enter}');
	expect(oncommit).toHaveBeenCalledExactlyOnceWith(-0.5);
	await input.clear();
	await userEvent.type(input, '-2');
	await userEvent.keyboard('{Backspace}');
	await expect.element(input).toHaveValue('-');
	await userEvent.keyboard('{Escape}');
	await expect.element(input).toHaveValue('1.00');
	expect(oncommit).toHaveBeenCalledTimes(1);
	expect(oncancel).toHaveBeenCalledOnce();
	expect(onlive).toHaveBeenLastCalledWith(1);
});

it('commits a pointer scrub through the input', async () => {
	const onlive = vi.fn();
	const oncommit = vi.fn();
	const screen = await render(EditorScrubbableNumberInput, {
		ariaLabel: 'Position',
		value: 10,
		step: 1,
		onlive,
		oncommit
	});
	await expect.element(screen.getByRole('textbox', { name: 'Position' })).toBeVisible();
	const input = document.querySelector<HTMLInputElement>('input[aria-label="Position"]');
	if (!input) throw new Error('Expected the editor number input');
	input.setPointerCapture = vi.fn();
	input.hasPointerCapture = vi.fn(() => false);
	await new Promise((resolve) => requestAnimationFrame(resolve));
	input.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 100 })
	);
	expect(input.setPointerCapture).toHaveBeenCalledWith(1);
	input.dispatchEvent(
		new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: 110 })
	);
	input.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 110 })
	);
	expect(onlive).toHaveBeenCalledWith(20);
	expect(oncommit).toHaveBeenCalledWith(20);
});
