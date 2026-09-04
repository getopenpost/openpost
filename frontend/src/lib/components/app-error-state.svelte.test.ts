import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AppErrorState from './app-error-state.svelte';

describe('AppErrorState', () => {
	it('renders a retryable server failure and moves focus to its heading', async () => {
		const onRetry = vi.fn();
		const screen = await render(AppErrorState, {
			status: 503,
			online: true,
			onBack: vi.fn(),
			onRetry
		});

		const heading = screen.getByRole('heading', { name: 'OpenPost could not show this page' });
		await expect.element(heading).toHaveFocus();
		await expect.element(screen.getByTestId('app-error-page')).not.toHaveAttribute('aria-live');
		const retry = screen.getByRole('button', { name: 'Try again' });
		await retry.click();
		expect(onRetry).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('link', { name: 'Contact support' })).toBeVisible();
		await expect
			.element(screen.getByRole('link', { name: 'Documentation' }))
			.not.toBeInTheDocument();
	});

	it('withholds retry for forbidden access without mislabeling it', async () => {
		const screen = await render(AppErrorState, {
			status: 403,
			online: true,
			onBack: vi.fn(),
			onRetry: vi.fn()
		});

		await expect
			.element(screen.getByRole('heading', { name: 'You cannot open this page' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
		await expect.element(screen.getByText('HTTP 403')).toBeVisible();
	});

	it('reports the connection state before the underlying HTTP failure', async () => {
		const screen = await render(AppErrorState, {
			status: 500,
			online: false,
			onBack: vi.fn(),
			onRetry: vi.fn()
		});

		await expect.element(screen.getByRole('heading', { name: 'You are offline' })).toBeVisible();
		await expect.element(screen.getByText('Reconnect, then try this page again.')).toBeVisible();
		await expect
			.element(screen.getByRole('link', { name: 'Contact support' }))
			.not.toBeInTheDocument();
	});

	it('does not mislabel a rejected client request as a server failure', async () => {
		const screen = await render(AppErrorState, {
			status: 401,
			online: true,
			onBack: vi.fn(),
			onRetry: vi.fn()
		});

		await expect
			.element(screen.getByRole('heading', { name: 'OpenPost could not complete this request' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('link', { name: 'Contact support' }))
			.not.toBeInTheDocument();
	});
});
