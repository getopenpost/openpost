import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import ImageIcon from '@lucide/svelte/icons/image';
import { resolveBuiltInTheme, WebThemeRuntime, type ThemeRuntimeLoaders } from '$lib/themes';
import AppToast from './app-toast.svelte';
import { Toaster } from './ui/sonner';
import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
import EmptyState from './empty-state.svelte';
import PageContainer from './page-container.svelte';
import PageHeader from './page-header.svelte';
import PageLoading from './page-loading.svelte';
import * as Sidebar from './ui/sidebar';
import '../../routes/layout.css';

const originalIconPack = document.documentElement.getAttribute('data-theme-icon-pack');

afterEach(() => {
	if (originalIconPack)
		document.documentElement.setAttribute('data-theme-icon-pack', originalIconPack);
	else document.documentElement.removeAttribute('data-theme-icon-pack');
});

function textSnippet(text: string) {
	return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

function themedContent() {
	return createRawSnippet(() => ({
		render: () =>
			'<div><p data-testid="runtime-display" data-theme-type="display">12 posts</p><code data-testid="runtime-code" data-theme-type="code">POST /api/v1/publications</code></div>'
	}));
}

function sidebarProbe() {
	return createRawSnippet(() => ({
		render: () => '<div data-testid="sidebar-width-probe" style="width:var(--sidebar-width)"></div>'
	}));
}

function themeRuntime() {
	const loaders: ThemeRuntimeLoaders = {
		stageFonts: async () => ({ release: () => undefined }),
		loadAssets: async () => undefined,
		loadIconPack: async () => undefined,
		setBrowserSurface: () => () => undefined
	};
	return new WebThemeRuntime(loaders);
}

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

	it.each([
		['notebook', 'light', 'Source Serif 4', '28px'],
		['midnight', 'dark', 'Inter Tight', '24px']
	] as const)(
		'applies %s typography and spacing through shared page chrome',
		async (family, scheme, titleFamily, sectionGap) => {
			const theme = resolveBuiltInTheme(family, scheme);
			const screen = render(PageContainer, {
				title: `${theme.name} workspace`,
				description: 'One complete visual system.',
				children: themedContent()
			});
			const container = screen.container.querySelector<HTMLElement>(
				'[data-slot="page-container"]'
			)!;
			await themeRuntime().applyScoped(theme, container);

			const title = screen.getByRole('heading', { level: 1 }).element();
			const description = screen.getByText('One complete visual system.').element();
			const display = screen.getByTestId('runtime-display').element();
			const code = screen.getByTestId('runtime-code').element();
			const header = screen.getByTestId('page-header').element();

			expect(getComputedStyle(container).gap).toBe(sectionGap);
			expect(getComputedStyle(container).maxWidth).toBe('1152px');
			expect(Number.parseFloat(getComputedStyle(container).paddingLeft)).toBeGreaterThanOrEqual(16);
			expect(getComputedStyle(header).minHeight).toBe('56px');
			expect(getComputedStyle(title).fontFamily).toContain(titleFamily);
			expect(getComputedStyle(title).fontWeight).toBe(
				String(theme.manifest.typography.title.weight)
			);
			expect(getComputedStyle(description).fontSize).toBe('14px');
			expect(getComputedStyle(description).lineHeight).toBe('21px');
			expect(getComputedStyle(display).fontWeight).toBe(
				String(theme.manifest.typography.display.weight)
			);
			expect(getComputedStyle(code).fontFamily).toContain('Geist Mono');
		}
	);

	it('applies label and metadata roles to real page header content', async () => {
		const theme = resolveBuiltInTheme('notebook', 'light');
		const screen = render(PageHeader, {
			title: 'Publishing plan',
			eyebrow: 'September',
			description: 'Review the next scheduled posts.',
			meta: textSnippet('Updated 5 minutes ago')
		});
		const header = screen.getByTestId('page-header').element();
		await themeRuntime().applyScoped(theme, header);

		expect(getComputedStyle(screen.getByText('September').element()).fontSize).toBe('13px');
		expect(getComputedStyle(screen.getByText('September').element()).fontWeight).toBe('600');
		expect(getComputedStyle(screen.getByText('Updated 5 minutes ago').element()).fontSize).toBe(
			'12px'
		);
		expect(getComputedStyle(screen.getByText('Updated 5 minutes ago').element()).lineHeight).toBe(
			'16.2px'
		);
	});

	it('resolves the desktop sidebar through the theme shell width', async () => {
		const screen = render(Sidebar.Provider, { children: sidebarProbe() });
		const wrapper = screen.container.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!;
		await themeRuntime().applyScoped(resolveBuiltInTheme('midnight', 'dark'), wrapper);

		expect(getComputedStyle(screen.getByTestId('sidebar-width-probe').element()).width).toBe(
			'256px'
		);
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

	it('lets shared empty states resolve semantic icons from the active theme', async () => {
		document.documentElement.setAttribute('data-theme-icon-pack', 'phosphor');
		const screen = await render(EmptyState, {
			themeIconRole: 'image',
			title: 'No media yet'
		});
		const icon = screen.container.querySelector('[data-theme-icon="image"]');

		expect(icon).not.toBeNull();
		await vi.waitFor(() => expect(icon?.getAttribute('data-icon-pack')).toBe('phosphor'));
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
