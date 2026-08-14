import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ConnectivityNotice from './connectivity-notice.svelte';

describe('ConnectivityNotice', () => {
	it('keeps page context visible while reporting an offline browser', async () => {
		const screen = await render(ConnectivityNotice, { online: false });

		await expect.element(screen.getByText('You are offline.')).toBeVisible();
		await expect.element(screen.getByText('Reconnect to continue using OpenPost.')).toBeVisible();
		await expect.element(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');

		await screen.rerender({ online: true });
		await expect.element(screen.getByText('You are offline.')).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent('You are back online. You can continue.');
	});
});
