import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PollBuilder from './poll-builder.svelte';

describe('PollBuilder', () => {
	it('keeps an unset poll optional', async () => {
		const onChange = vi.fn();
		const screen = await render(PollBuilder, {
			props: {
				id: 'x-poll',
				value: '',
				onChange
			}
		});

		await expect.element(screen.getByRole('button', { name: 'Add poll' })).toBeVisible();
		expect(screen.container.querySelectorAll('input')).toHaveLength(0);
	});

	it('can add and remove the whole poll', async () => {
		const onChange = vi.fn();
		const screen = await render(PollBuilder, {
			props: {
				id: 'x-poll',
				value: '\n',
				onChange
			}
		});

		await expect.element(screen.getByPlaceholder('Option 1')).toBeVisible();
		await screen.getByRole('button', { name: 'Remove poll' }).click();

		expect(onChange).toHaveBeenCalledWith('');
	});
});
