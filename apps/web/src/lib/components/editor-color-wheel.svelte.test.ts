import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'svelte';
import ColorWheel from './editor-color-wheel.svelte';

async function renderWheel(
	props: Partial<ComponentProps<typeof ColorWheel>> = {},
	focusable = true
) {
	const oncommit = vi.fn();
	const screen = await render(ColorWheel, {
		label: 'Saturation',
		value: { hue: 0, amount: 0.5 },
		onpreview: vi.fn(),
		oncommit,
		oncancel: vi.fn(),
		...props
	});
	const slider = screen.getByRole('slider', { name: 'Saturation color wheel' });
	if (focusable) {
		// SAFETY: wheel slider locators resolve to HTMLElement hosts, which support focus().
		(slider.element() as HTMLElement).focus();
		await expect.element(slider).toHaveFocus();
	}
	return { screen, slider, oncommit };
}

describe('Color wheel slider keyboard', () => {
	it('moves in large steps with PageUp and PageDown', async () => {
		const { oncommit } = await renderWheel();
		await userEvent.keyboard('{PageUp}');
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit.mock.calls[0][0].amount).toBeCloseTo(0.6, 10);
		oncommit.mockClear();
		await userEvent.keyboard('{PageDown}');
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit.mock.calls[0][0].amount).toBeCloseTo(0.4, 10);
	});

	it('keeps arrow small steps and Home/End jumps', async () => {
		const { oncommit } = await renderWheel();
		await userEvent.keyboard('{ArrowUp}');
		expect(oncommit.mock.calls[0][0].amount).toBeCloseTo(0.51, 10);
		oncommit.mockClear();
		await userEvent.keyboard('{Home}');
		expect(oncommit.mock.calls[0][0].amount).toBe(0);
		oncommit.mockClear();
		await userEvent.keyboard('{End}');
		expect(oncommit.mock.calls[0][0].amount).toBe(1);
	});

	it('ignores PageUp and PageDown while disabled', async () => {
		// A disabled native button cannot take focus, so keys go to the body instead.
		const { oncommit } = await renderWheel({ disabled: true }, false);
		await userEvent.keyboard('{PageUp}{PageDown}');
		expect(oncommit).not.toHaveBeenCalled();
	});
});
