import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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

			const deleteButton = screen.getByRole('button', { name: 'Delete' });
			deleteButton.element().focus();
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			await expect.element(deleteButton).toHaveFocus();
			await expect.element(screen.getByRole('dialog')).toBeVisible();
			await expect.element(screen.getByText('This cannot be undone.')).toBeVisible();
			expect(onConfirm).not.toHaveBeenCalled();
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

	it('still closes on Escape while idle', async () => {
		const onConfirm = vi.fn(async () => ({ ok: true }));
		const screen = await render(DestructiveConfirmDialog, {
			open: true,
			title: 'Delete this item?',
			description: 'This cannot be undone.',
			onConfirm
		});

		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('refuses Escape and outside dismissal while the action is pending and keeps the failure visible', async () => {
		let resolveConfirm!: (value: { ok: false; message: string }) => void;
		const onConfirm = vi.fn(
			() =>
				new Promise<{ ok: false; message: string }>((resolve) => {
					resolveConfirm = resolve;
				})
		);
		const screen = await render(DestructiveConfirmDialog, {
			open: true,
			title: 'Delete this item?',
			description: 'This cannot be undone.',
			onConfirm
		});

		await screen.getByRole('button', { name: 'Delete' }).click();
		expect(onConfirm).toHaveBeenCalledOnce();

		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('dialog')).toBeVisible();

		const overlay = document.querySelector('[data-slot="dialog-overlay"]');
		if (!overlay) throw new Error('Expected dialog overlay');
		// Explicit far-below coordinates: bits-ui accepts an outside interaction only
		// when the pointer position falls outside the content rect, and synthetic
		// events default to (0, 0), which can land inside unstyled content.
		overlay.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				button: 0,
				clientX: 10,
				clientY: 1000
			})
		);
		// bits-ui evaluates outside interactions on a short debounce; let it fire
		// while the action is still pending so the guard is what keeps the dialog open.
		await new Promise((resolve) => setTimeout(resolve, 50));
		await expect.element(screen.getByRole('dialog')).toBeVisible();

		resolveConfirm({ ok: false, message: 'The server rejected deletion.' });
		await expect.element(screen.getByText('The server rejected deletion.')).toBeVisible();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
	});
});
