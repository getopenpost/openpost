import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import EditorWorkspaceSwitcher from './editor-workspace-switcher.svelte';

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('exposes stable Edit, Color, and Motion tabs', async () => {
	const onchange = vi.fn();
	const screen = await render(EditorWorkspaceSwitcher, {
		value: 'edit',
		onchange
	});

	const edit = screen.getByRole('tab', { name: 'Edit' });
	const color = screen.getByRole('tab', { name: 'Color' });
	const motion = screen.getByRole('tab', { name: 'Motion' });
	await expect.element(edit).toHaveAttribute('aria-selected', 'true');
	await expect.element(color).toHaveAttribute('aria-selected', 'false');
	await motion.click();
	expect(onchange).toHaveBeenCalledExactlyOnceWith('motion');
});

test('moves tab focus and selection intent with editor keyboard controls', async () => {
	const onchange = vi.fn();
	const screen = await render(EditorWorkspaceSwitcher, {
		value: 'edit',
		onchange
	});
	const edit = screen.getByRole('tab', { name: 'Edit' });

	edit.element().focus();
	await userEvent.keyboard('{ArrowRight}');
	expect(onchange).toHaveBeenCalledExactlyOnceWith('color');
	await expect.element(screen.getByRole('tab', { name: 'Color' })).toHaveFocus();
});

test('keeps every icon-only phone tab named and inside its row', async () => {
	await page.viewport(320, 720);
	const screen = await render(EditorWorkspaceSwitcher, {
		value: 'color',
		onchange: vi.fn()
	});

	await expect
		.element(screen.getByRole('tab', { name: 'Color' }))
		.toHaveAttribute('aria-selected', 'true');
	const tablist = screen.getByRole('tablist', { name: 'Editor workspaces' }).element();
	expect(tablist.scrollWidth).toBeLessThanOrEqual(tablist.clientWidth);
	for (const name of ['Edit', 'Color', 'Motion']) {
		const bounds = screen.getByRole('tab', { name }).element().getBoundingClientRect();
		expect(bounds.width).toBeGreaterThanOrEqual(44);
		expect(bounds.height).toBeGreaterThanOrEqual(44);
	}
});
