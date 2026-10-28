import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Fixture from './form-field.fixture.svelte';

describe('form field', () => {
	it('associates the label, marks required fields, and wires the error only when visible', async () => {
		const screen = await render(Fixture, {
			required: true,
			error: 'Enter a name.',
			touched: false,
			description: 'Shown under your posts.'
		});
		const input = screen.getByRole('textbox', { name: 'Display name' });
		await expect.element(input).toBeVisible();
		await expect.element(screen.getByText('*', { exact: true })).toBeVisible();

		await expect.element(screen.getByRole('status')).toHaveTextContent('');
		await expect.element(screen.getByRole('status')).toHaveAttribute('id', 'display-name-error');
		await expect.element(input).not.toHaveAttribute('aria-invalid');
		await expect.element(input).toHaveAttribute('aria-describedby', 'display-name-description');

		await screen.rerender({ error: 'Enter a name.', touched: true });
		await expect.element(screen.getByRole('status')).toHaveTextContent('Enter a name.');
		await expect.element(screen.getByRole('status')).toHaveAttribute('id', 'display-name-error');
		await expect.element(input).toHaveAttribute('aria-invalid', 'true');
		await expect
			.element(input)
			.toHaveAttribute('aria-describedby', 'display-name-description display-name-error');
	});
});
