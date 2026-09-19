import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import Fixture from './tool-family-button.fixture.svelte';
import '../../../routes/layout.css';

it.each(['rail', 'bottom'] as const)(
	'%s layout activates the remembered variant first, then opens its menu from the same button',
	async (layout) => {
		const onactivate = vi.fn();
		const screen = await render(Fixture, { onactivate, layout });
		const family = screen.getByRole('button', { name: 'Pixel select', exact: true });
		if (layout === 'bottom') {
			expect((await family.element()).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		}
		await family.click();
		expect(onactivate).toHaveBeenCalledOnce();
		expect(screen.getByRole('menuitem', { name: 'Ellipse select' }).query()).toBeNull();
		await family.click();
		expect(onactivate).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('menuitem', { name: 'Ellipse select' })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(family).toHaveFocus();
	}
);

it.each([
	['rail', '{ArrowDown}'],
	['rail', '{ArrowRight}'],
	['bottom', '{ArrowDown}'],
	['bottom', '{ArrowRight}']
] as const)('%s layout opens variants with %s', async (layout, key) => {
	const screen = await render(Fixture, { onactivate: vi.fn(), layout });
	const family = screen.getByRole('button', { name: 'Pixel select', exact: true });
	(await family.element()).focus();
	await userEvent.keyboard(key);
	await expect.element(screen.getByRole('menuitem', { name: 'Rectangle select' })).toBeVisible();
});

it.each(['rail', 'bottom'] as const)(
	'%s layout activates an inactive family with Enter without opening its menu',
	async (layout) => {
		const onactivate = vi.fn();
		const screen = await render(Fixture, { onactivate, layout });
		const family = screen.getByRole('button', { name: 'Pixel select', exact: true });
		(await family.element()).focus();
		await userEvent.keyboard('{Enter}');
		expect(onactivate).toHaveBeenCalledOnce();
		expect(screen.getByRole('menuitem', { name: 'Rectangle select' }).query()).toBeNull();
	}
);

it.each(['rail', 'bottom'] as const)(
	'%s layout opens variants from the context-menu shortcut',
	async (layout) => {
		const screen = await render(Fixture, { onactivate: vi.fn(), layout });
		const family = screen.getByTestId('image-editor-tool-family');
		(await family.element()).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
		);
		await expect.element(screen.getByRole('menuitem', { name: 'Rectangle select' })).toBeVisible();
	}
);
