import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { setLocale } from '$lib/paraglide/runtime';
import AppErrorState from './app-error-state.svelte';

describe('AppErrorState', () => {
	afterEach(async () => {
		setLocale('en', { reload: false });
		document.documentElement.classList.remove('dark');
		await page.viewport(1280, 900);
	});

	it('renders a retryable server failure and moves focus to its heading', async () => {
		await page.viewport(320, 800);
		document.documentElement.classList.remove('dark');
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
		await expect.element(screen.getByRole('button', { name: 'Try again' })).toHaveClass(/h-11/);
		await screen.getByRole('button', { name: 'Try again' }).click();
		expect(onRetry).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('link', { name: 'Contact support' })).toBeVisible();
		await expect
			.element(screen.getByRole('link', { name: 'Documentation' }))
			.not.toBeInTheDocument();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
	});

	it('distinguishes localized forbidden access at 390px dark mode without a misleading retry', async () => {
		await page.viewport(390, 844);
		setLocale('pt', { reload: false });
		document.documentElement.classList.add('dark');
		const screen = await render(AppErrorState, {
			status: 403,
			online: true,
			onBack: vi.fn(),
			onRetry: vi.fn()
		});

		await expect
			.element(screen.getByRole('heading', { name: 'Não podes abrir esta página' }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Tentar novamente' }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByText('HTTP 403')).toBeVisible();
		expect(document.documentElement).toHaveClass('dark');
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
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
