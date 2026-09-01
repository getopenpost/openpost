import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import ImageIcon from '@lucide/svelte/icons/image';
import AppToast from './app-toast.svelte';
import { Toaster } from './ui/sonner';
import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
import EmptyState from './empty-state.svelte';
import PageContainer from './page-container.svelte';
import PageHeader from './page-header.svelte';
import PageLoading from './page-loading.svelte';

function textSnippet(text: string) {
	return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('shared page states', () => {
	afterEach(() => vi.useRealTimers());

	it('renders one semantic page heading with its supporting copy', async () => {
		const screen = await render(PageHeader, {
			title: 'Media Library',
			description: 'Reuse uploaded files across posts.'
		});

		await expect
			.element(screen.getByRole('heading', { level: 1, name: 'Media Library' }))
			.toBeVisible();
		await expect.element(screen.getByText('Reuse uploaded files across posts.')).toBeVisible();
		await expect
			.element(screen.getByTestId('page-header'))
			.toHaveAttribute('data-slot', 'page-header');
	});

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

	it.each([
		['grid', 3],
		['gallery', 2]
	] as const)('renders exactly the requested %s loading items', async (layout, items) => {
		const screen = await render(PageLoading, {
			layout,
			label: 'Loading items',
			items
		});

		const loadingItems = screen.container.querySelector(
			'[data-slot="page-loading"] > div'
		)?.children;
		expect(loadingItems).toHaveLength(items);
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

	it('keeps an empty-state action attached to a correctly nested heading', async () => {
		const onAction = vi.fn();
		const screen = await render(EmptyState, {
			icon: ImageIcon,
			title: 'No media yet',
			description: 'Upload a file to reuse it later.',
			actionLabel: 'Upload',
			onAction,
			headingLevel: 3
		});

		await expect
			.element(screen.getByRole('heading', { level: 3, name: 'No media yet' }))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Upload' }).click();
		expect(onAction).toHaveBeenCalledOnce();
	});

	it('renders an error toast with a dismiss action', async () => {
		const onDismiss = vi.fn();
		await render(Toaster);
		const screen = await render(AppToast, {
			message: 'Upload failed',
			dismissLabel: 'Dismiss notification',
			onDismiss,
			tone: 'error'
		});
		await expect.element(screen.getByText('Upload failed')).toBeVisible();
		await screen.getByRole('button', { name: 'Close toast' }).click();
		expect(onDismiss).toHaveBeenCalledOnce();
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
		const onConfirm = vi.fn(async () => ({ ok: false, message: 'The server rejected deletion.' }));
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
