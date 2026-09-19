import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import Fixture from './tool-family-button.fixture.svelte';
import '../../../routes/layout.css';

it('keeps the remembered tool action separate from the visible variant menu', async () => {
	const onactivate = vi.fn();
	const screen = await render(Fixture, { onactivate });
	await screen.getByRole('button', { name: 'Pixel select', exact: true }).click();
	expect(onactivate).toHaveBeenCalledOnce();
	expect(screen.getByRole('menuitem', { name: 'Ellipse select' }).query()).toBeNull();
	await screen.getByRole('button', { name: 'Pixel select, More actions' }).click();
	await expect.element(screen.getByRole('menuitem', { name: 'Ellipse select' })).toBeVisible();
});

it('opens variants from the keyboard and the existing context-menu shortcut', async () => {
	const screen = await render(Fixture, { onactivate: vi.fn() });
	const variants = screen.getByRole('button', { name: 'Pixel select, More actions' });
	(await variants.element()).focus();
	await userEvent.keyboard('{Enter}');
	await expect.element(screen.getByRole('menuitem', { name: 'Rectangle select' })).toBeVisible();
	await userEvent.keyboard('{Escape}');
	const family = screen.getByTestId('image-editor-tool-family');
	(await family.element()).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
	await expect.element(screen.getByRole('menuitem', { name: 'Rectangle select' })).toBeVisible();
});
