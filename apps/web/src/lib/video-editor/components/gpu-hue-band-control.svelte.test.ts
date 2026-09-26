import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import HueBandControl from './gpu-hue-band-control.svelte';
import type { ComponentProps } from 'svelte';

async function renderControl(
	props: Partial<ComponentProps<typeof HueBandControl>> = {},
	focusable = true
) {
	const oncommit = vi.fn();
	const screen = await render(HueBandControl, {
		center: 100,
		width: 30,
		softness: 10,
		label: 'Key hue',
		onlive: vi.fn(),
		oncommit,
		...props
	});
	const slider = screen.getByRole('slider', { name: 'Key hue' });
	if (focusable) {
		// SAFETY: hue-band slider locators resolve to HTMLElement hosts, which support focus().
		(slider.element() as HTMLElement).focus();
		await expect.element(slider).toHaveFocus();
	}
	return { screen, slider, oncommit };
}

describe('Hue band slider keyboard', () => {
	it('moves in large steps with PageUp and PageDown', async () => {
		const { oncommit } = await renderControl();
		await userEvent.keyboard('{PageUp}');
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit.mock.calls[0][0]).toBe(110);
		oncommit.mockClear();
		await userEvent.keyboard('{PageDown}');
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit.mock.calls[0][0]).toBe(90);
	});

	it('keeps arrow small steps and Home/End jumps', async () => {
		const { oncommit } = await renderControl();
		await userEvent.keyboard('{ArrowRight}');
		expect(oncommit.mock.calls[0][0]).toBe(101);
		oncommit.mockClear();
		await userEvent.keyboard('{Home}');
		expect(oncommit.mock.calls[0][0]).toBe(0);
		oncommit.mockClear();
		await userEvent.keyboard('{End}');
		expect(oncommit.mock.calls[0][0]).toBe(360);
	});

	it('ignores PageUp and PageDown while disabled', async () => {
		// A disabled native button cannot take focus, so keys go to the body instead.
		const { oncommit } = await renderControl({ disabled: true }, false);
		await userEvent.keyboard('{PageUp}{PageDown}');
		expect(oncommit).not.toHaveBeenCalled();
	});
});
