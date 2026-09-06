import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import Fixture from './reorder-list.fixture.svelte';
import '../../routes/layout.css';
const items = [
	{ key: 'one', name: 'First' },
	{ key: 'two', name: 'Second' },
	{ key: 'three', name: 'Third' }
];
it('previews and cancels with the keyboard, then commits once without changing source items', async () => {
	const onReorder = vi.fn();
	const screen = await render(Fixture, { items, onReorder });
	await screen.getByRole('button', { name: 'Move First' }).click();
	await userEvent.keyboard(' {ArrowDown}{ArrowDown}');
	await expect.element(screen.getByRole('button', { name: 'Move First' })).toHaveFocus();
	expect(onReorder).not.toHaveBeenCalled();
	expect(items.map((item) => item.key)).toEqual(['one', 'two', 'three']);
	await userEvent.keyboard('{Escape}');
	expect(onReorder).not.toHaveBeenCalled();
	await userEvent.keyboard(' {ArrowDown} ');
	expect(onReorder).toHaveBeenCalledOnce();
	expect(onReorder.mock.calls[0][0].map((item: { key: string }) => item.key)).toEqual([
		'two',
		'one',
		'three'
	]);
});
it('cancels a preview when its workspace changes and leaves text editing shortcuts alone', async () => {
	const onReorder = vi.fn();
	const screen = await render(Fixture, { items, onReorder });
	await screen.getByRole('button', { name: 'Move First' }).click();
	await userEvent.keyboard(' {ArrowDown}');
	await screen.rerender({ scope: 'workspace-2' });
	await expect
		.element(screen.getByRole('button', { name: 'Move First' }))
		.toHaveAttribute('aria-pressed', 'false');
	expect(onReorder).not.toHaveBeenCalled();
	await screen.getByRole('textbox', { name: 'First', exact: true }).click();
	await userEvent.keyboard('{Control>}{ArrowDown}{/Control}');
	expect(onReorder).not.toHaveBeenCalled();
});
it('commits a pointer reorder once while preserving the controlled input array', async () => {
	const onReorder = vi.fn();
	const screen = await render(Fixture, { items, onReorder });
	await screen
		.getByRole('button', { name: 'Move First' })
		.dropTo(screen.getByRole('button', { name: 'Move Third' }));
	expect(onReorder).toHaveBeenCalledOnce();
	expect(onReorder.mock.calls[0][0].map((item: { key: string }) => item.key)).toEqual([
		'two',
		'three',
		'one'
	]);
	expect(items.map((item) => item.key)).toEqual(['one', 'two', 'three']);
});
