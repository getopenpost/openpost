import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ReusableLibrary from './reusable-library.svelte';
import { videoLibrary } from '../library/library-store.svelte';
import '../../../routes/layout.css';

it('explains filtered results and clears filters without losing saved recipes', async () => {
	const prior = videoLibrary.scope;
	await videoLibrary.load(`library-filter-${crypto.randomUUID()}`);
	await videoLibrary.save('Audit fade', { kind: 'transition', presentation: 'fade' }, 'Tutorials');
	await videoLibrary.save(
		'Unfavorited recipe',
		{ kind: 'transition', presentation: 'fade' },
		'Archive',
		false
	);
	const screen = await render(ReusableLibrary, {
		selectedIds: [],
		oninserted: () => {},
		onedit: () => {},
		ontransition: () => {}
	});
	screen.container.style.cssText = 'width:min(100%,320px)';
	try {
		for (const width of [1280, 390, 320])
			for (const dark of [false, true]) {
				await page.viewport(width, 850);
				document.documentElement.classList.toggle('dark', dark);
				const search = screen.getByRole('searchbox', { name: 'Search library', exact: true });
				await search.fill('not a saved recipe');
				await expect
					.element(
						screen.getByText('Favorite items in the galleries or save a timeline selection.', {
							exact: true
						})
					)
					.not.toBeInTheDocument();
				await expect
					.element(screen.getByText('No library items match these filters.', { exact: true }))
					.toBeVisible();
				await expect
					.element(screen.getByRole('button', { name: 'Audit fade', exact: true }))
					.not.toBeInTheDocument();
				await page.screenshot({ path: `__screenshots__/library-no-results-${width}-${dark}.png` });
				await screen.getByRole('button', { name: 'Clear filters', exact: true }).click();
				await expect.element(search).toHaveValue('');
				await expect
					.element(screen.getByRole('button', { name: 'Audit fade', exact: true }))
					.toBeVisible();
				await expect.element(search).toHaveFocus();
				await screen.getByRole('button', { name: 'Collection, optional', exact: true }).click();
				await page.getByRole('option', { name: 'Archive', exact: true }).click();
				await expect
					.element(screen.getByText('No library items match these filters.', { exact: true }))
					.toBeVisible();
				await screen.getByRole('button', { name: 'Clear filters', exact: true }).click();
				await expect
					.element(screen.getByRole('button', { name: 'Audit fade', exact: true }))
					.toBeVisible();
				await expect.element(search).toHaveFocus();
			}
	} finally {
		document.documentElement.classList.remove('dark');
		await screen.unmount();
		screen.container.remove();
		for (const entry of [...videoLibrary.entries]) await videoLibrary.remove(entry);
		await videoLibrary.load(prior);
	}
}, 30000);

it('names recipe actions separately from insertion and opens them with the keyboard', async () => {
	const prior = videoLibrary.scope;
	await videoLibrary.load(`library-actions-${crypto.randomUUID()}`);
	await videoLibrary.save('Audit fade', { kind: 'transition', presentation: 'fade' });
	const ontransition = vi.fn();
	const screen = await render(ReusableLibrary, {
		selectedIds: [],
		oninserted: () => {},
		onedit: () => {},
		ontransition
	});
	try {
		await expect
			.element(screen.getByRole('button', { name: 'Audit fade', exact: true }))
			.toBeVisible();
		const more = screen.getByRole('button', { name: 'More actions for Audit fade', exact: true });
		more.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect
			.element(page.getByRole('menuitem', { name: 'Remove Audit fade from library', exact: true }))
			.toBeVisible();
		expect(ontransition).not.toHaveBeenCalled();
		await userEvent.keyboard('{Escape}');
		await screen.getByRole('button', { name: 'Audit fade', exact: true }).click();
		expect(ontransition).toHaveBeenCalledWith('fade', undefined);
		await expect.poll(() => videoLibrary.entries[0]?.lastUsed ?? 0).toBeGreaterThan(0);
	} finally {
		await screen.unmount();
		screen.container.remove();
		for (const entry of [...videoLibrary.entries]) await videoLibrary.remove(entry);
		await videoLibrary.load(prior);
	}
}, 30000);
