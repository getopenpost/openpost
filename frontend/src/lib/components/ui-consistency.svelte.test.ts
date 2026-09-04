import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
import PageContainer from './page-container.svelte';
import PageLoading from './page-loading.svelte';
import '../../routes/layout.css';

function textSnippet(text: string) {
	return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('shared page states', () => {
	afterEach(() => vi.useRealTimers());

	it('announces a content-shaped loading state without adding another heading', async () => {
		const screen = await render(PageLoading, {
			layout: 'settings',
			variant: 'list',
			label: 'Loading settings'
		});

		const status = screen.getByRole('status');
		await expect.element(status).toHaveAttribute('aria-busy', 'true');
		await expect.element(status).toHaveAttribute('data-layout', 'settings');
		await expect.element(status).toHaveAttribute('data-variant', 'list');
		await expect.element(screen.getByText('Loading settings')).toBeInTheDocument();
		await expect.element(screen.getByRole('heading')).not.toBeInTheDocument();
	});

	it('does not flash a page loader when content resolves within 150 ms', async () => {
		vi.useFakeTimers();
		const props = {
			title: 'Drafts',
			loading: true,
			loadingMessage: 'Loading drafts',
			actions: textSnippet('Create draft'),
			children: textSnippet('Loaded drafts')
		};
		const screen = await render(PageContainer, props);

		await vi.advanceTimersByTimeAsync(100);
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();
		await expect.element(screen.getByText('Loaded drafts')).not.toBeInTheDocument();

		await screen.rerender({ ...props, loading: false });
		await expect.element(screen.getByText('Loaded drafts')).toBeVisible();
		await expect.element(screen.getByText('Create draft')).toBeVisible();
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(20);
		await screen.rerender(props);
		await vi.advanceTimersByTimeAsync(30);
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(119);
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();
		await vi.advanceTimersByTimeAsync(1);
		await expect.element(screen.getByTestId('page-loading')).toBeVisible();
	});

	it('shows one content-shaped page loader after the 150 ms delay', async () => {
		vi.useFakeTimers();
		const screen = await render(PageContainer, {
			title: 'Drafts',
			loading: true,
			loadingMessage: 'Loading drafts',
			actions: textSnippet('Create draft'),
			children: textSnippet('Loaded drafts')
		});

		await vi.advanceTimersByTimeAsync(149);
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();
		await expect.element(screen.getByText('Create draft')).not.toBeInTheDocument();
		const delayedAction = screen.container.querySelector(
			'[data-slot="page-header-actions"] [data-slot="skeleton"]'
		);
		expect(delayedAction).not.toBeNull();
		expect(delayedAction?.classList.contains('invisible')).toBe(true);

		await vi.advanceTimersByTimeAsync(1);
		await expect.element(screen.getByTestId('page-loading')).toBeVisible();
		await expect.element(screen.getByText('Loading drafts')).toBeInTheDocument();
		await expect.element(screen.getByText('Loaded drafts')).not.toBeInTheDocument();
		expect(screen.container.querySelectorAll('[data-slot="page-loading"]')).toHaveLength(1);
		expect(delayedAction?.classList.contains('invisible')).toBe(false);

		await screen.rerender({
			title: 'Drafts',
			loading: false,
			loadingMessage: 'Loading drafts',
			actions: textSnippet('Create draft'),
			children: textSnippet('Loaded drafts')
		});
		await expect.element(screen.getByText('Create draft')).toBeVisible();
		expect(
			screen.container.querySelectorAll('[data-slot="page-header-actions"] [data-slot="skeleton"]')
		).toHaveLength(0);
	});

	it('mounts loading content once while keeping it hidden behind the page loader', async () => {
		vi.useFakeTimers();
		const children = createRawSnippet(() => ({
			render: () => '<input data-testid="mounted-page-content" value="">'
		}));
		const props = {
			title: 'Settings',
			loading: true,
			mountWhileLoading: true,
			loadingMessage: 'Loading settings',
			children
		};
		const screen = await render(PageContainer, props);
		const mountedInput = screen.container.querySelector<HTMLInputElement>(
			'[data-testid="mounted-page-content"]'
		);

		expect(mountedInput).not.toBeNull();
		await expect.element(screen.getByTestId('mounted-page-content')).not.toBeVisible();
		if (!mountedInput) throw new Error('Expected mounted page content');
		mountedInput.value = 'preserved';

		await vi.advanceTimersByTimeAsync(150);
		await expect.element(screen.getByTestId('page-loading')).toBeVisible();
		await screen.rerender({ ...props, loading: false });

		const revealedInput = screen.container.querySelector<HTMLInputElement>(
			'[data-testid="mounted-page-content"]'
		);
		expect(revealedInput).toBe(mountedInput);
		expect(revealedInput?.value).toBe('preserved');
		await expect.element(screen.getByTestId('mounted-page-content')).toBeVisible();
		await expect.element(screen.getByTestId('page-loading')).not.toBeInTheDocument();
	});

	it('requires an explicit action before confirming destructive work', async () => {
		const onConfirm = vi.fn(() => ({ ok: true }));
		const screen = await render(DestructiveConfirmDialog, {
			open: true,
			title: 'Delete this item?',
			description: 'This action cannot be undone.',
			onConfirm
		});

		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByText('This action cannot be undone.')).toBeVisible();
		await screen.getByRole('button', { name: 'Delete' }).click();
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('keeps destructive confirmation open when the action reports failure', async () => {
		const onConfirm = vi.fn(async () => ({
			ok: false,
			message: 'The server rejected deletion.'
		}));
		const screen = await render(DestructiveConfirmDialog, {
			open: true,
			title: 'Delete all notifications?',
			description: 'This action cannot be undone.',
			onConfirm
		});

		await screen.getByRole('button', { name: 'Delete' }).click();

		expect(onConfirm).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(screen.getByText('The server rejected deletion.')).toBeVisible();
	});
});
