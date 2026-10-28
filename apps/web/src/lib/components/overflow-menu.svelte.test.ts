import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Fixture from './overflow-menu.fixture.svelte';
import '../../routes/layout.css';

describe('OverflowMenu trigger contract', () => {
	it('exposes the caller label with a 44px phone target', async () => {
		await page.viewport(390, 900);
		try {
			const screen = await render(Fixture, { label: 'Post actions', onAction: vi.fn() });
			const trigger = screen.getByRole('button', { name: 'Post actions' });
			await expect.element(trigger).toBeVisible();
			const target = trigger.element().getBoundingClientRect();
			expect(target.width).toBeGreaterThanOrEqual(44);
			expect(target.height).toBeGreaterThanOrEqual(44);
		} finally {
			await page.viewport(1280, 900);
		}
	});

	it('opens with the keyboard and returns focus to the trigger on Escape', async () => {
		const screen = await render(Fixture, { label: 'Post actions', onAction: vi.fn() });
		const trigger = screen.getByRole('button', { name: 'Post actions' });
		(await trigger.element()).focus();
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
		await expect.element(trigger).toHaveFocus();
	});

	it('returns focus to the trigger after an action', async () => {
		const onAction = vi.fn();
		const screen = await render(Fixture, { label: 'Post actions', onAction });
		await screen.getByRole('button', { name: 'Post actions' }).click();
		await screen.getByRole('menuitem', { name: 'Delete' }).click();
		expect(onAction).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('button', { name: 'Post actions' })).toHaveFocus();
	});
});
