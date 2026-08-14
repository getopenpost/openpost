import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { setLocale } from '$lib/paraglide/runtime';
import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';

describe('DestructiveConfirmDialog', () => {
	afterEach(() => setLocale('en', { reload: false }));

	it('moves focus to a stable target after a successful destructive action', async () => {
		const returnFocus = document.createElement('h2');
		returnFocus.tabIndex = -1;
		returnFocus.textContent = 'Local designs';
		document.body.append(returnFocus);
		const onConfirm = vi.fn().mockResolvedValue({ ok: true });

		try {
			const screen = await render(DestructiveConfirmDialog, {
				open: true,
				title: 'Delete this design?',
				description: 'This cannot be undone.',
				onConfirm,
				returnFocus
			});

			await screen.getByRole('button', { name: 'Delete' }).click();

			expect(onConfirm).toHaveBeenCalledOnce();
			await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
			await expect.element(page.getByRole('heading', { name: 'Local designs' })).toHaveFocus();
		} finally {
			returnFocus.remove();
		}
	});

	it('falls back to the page heading when a consumer removes its trigger without a target', async () => {
		const main = document.createElement('main');
		const heading = document.createElement('h1');
		heading.textContent = 'Media library';
		main.append(heading);
		document.body.prepend(main);

		try {
			const screen = await render(DestructiveConfirmDialog, {
				open: true,
				title: 'Delete this item?',
				description: 'This cannot be undone.',
				onConfirm: vi.fn().mockResolvedValue({ ok: true })
			});

			await screen.getByRole('button', { name: 'Delete' }).click();

			await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
			await expect.element(page.getByRole('heading', { name: 'Media library' })).toHaveFocus();
		} finally {
			main.remove();
		}
	});
});
