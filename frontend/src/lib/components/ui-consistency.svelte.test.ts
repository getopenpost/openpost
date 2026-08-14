import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImageIcon from '@lucide/svelte/icons/image';
import AppToast from './app-toast.svelte';
import { Toaster } from './ui/sonner';
import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
import EmptyState from './empty-state.svelte';
import PageHeader from './page-header.svelte';
import PageLoading from './page-loading.svelte';

describe('shared page states', () => {
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
