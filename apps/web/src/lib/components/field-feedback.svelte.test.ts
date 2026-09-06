import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FieldFeedback from './field-feedback.svelte';

describe('field feedback', () => {
	it('keeps the linked error quiet until the field is touched', async () => {
		const screen = await render(FieldFeedback, {
			id: 'email-error',
			error: 'Enter a valid email address',
			touched: false
		});

		await expect.element(screen.getByRole('status')).toHaveTextContent('');
		await expect
			.element(screen.getByRole('status'))
			.not.toHaveTextContent('Enter a valid email address');

		await screen.rerender({ touched: true });
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent('Enter a valid email address');
		await expect.element(screen.getByRole('status')).toHaveAttribute('id', 'email-error');
	});
});
