import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EditorScrubbableNumberInput from './editor-scrubbable-number-input.svelte';

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
