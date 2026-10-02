import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import CheckpointRemove from './checkpoint-remove.svelte';
import type { ImageEditorRevisionSummary } from '../types';
import '../../../routes/layout.css';

const checkpoint: ImageEditorRevisionSummary = {
	id: 'remove-only-this',
	revision: 2,
	kind: 'checkpoint',
	name: 'Saved café checkpoint',
	created_at: '2026-10-02T12:00:00Z',
	actor: { name: 'Owner', is_current_user: true }
};

it('requires explicit confirmation, supports keyboard cancellation and retains failed removal for retry', async () => {
	const onremove = vi
		.fn()
		.mockRejectedValueOnce(new Error('Checkpoint removal unavailable'))
		.mockResolvedValueOnce(undefined);
	const screen = render(CheckpointRemove, { revision: checkpoint, canEdit: true, onremove });
	const trigger = screen.getByRole('button', { name: 'Remove checkpoint', exact: true });
	await trigger.click();
	await expect.element(screen.getByRole('dialog')).toBeVisible();
	await expect
		.element(screen.getByText(/Your current design and other versions will stay unchanged/))
		.toBeVisible();
	await userEvent.keyboard('{Escape}');
	await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	expect(onremove).not.toHaveBeenCalled();
	await expect.element(trigger).toHaveFocus();
	await userEvent.keyboard('{Enter}');
	const confirm = screen
		.getByRole('dialog')
		.getByRole('button', { name: 'Remove checkpoint', exact: true });
	await confirm.click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('Checkpoint removal unavailable');
	expect(onremove).toHaveBeenCalledWith(checkpoint);
	await confirm.click();
	await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	expect(onremove).toHaveBeenCalledTimes(2);
});

it('keeps recovery versions and read-only checkpoint history protected', async () => {
	const onremove = vi.fn();
	const screen = render(CheckpointRemove, { revision: checkpoint, canEdit: false, onremove });
	await expect.element(screen.getByRole('button', { name: 'Remove checkpoint' })).toBeDisabled();
	await screen.rerender({ revision: { ...checkpoint, kind: 'autosave' }, canEdit: true, onremove });
	await expect
		.element(screen.getByRole('button', { name: 'Remove checkpoint' }))
		.not.toBeInTheDocument();
	expect(onremove).not.toHaveBeenCalled();
});

it('keeps a pending removal fenced against duplicate confirmation and Escape dismissal', async () => {
	let finish!: () => void;
	const onremove = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			})
	);
	const screen = render(CheckpointRemove, { revision: checkpoint, canEdit: true, onremove });
	await screen.getByRole('button', { name: 'Remove checkpoint', exact: true }).click();
	const confirm = screen
		.getByRole('dialog')
		.getByRole('button', { name: 'Remove checkpoint', exact: true });
	await confirm.click();
	await expect.element(confirm).toBeDisabled();
	await expect
		.element(screen.getByRole('button', { name: 'Close', exact: true }))
		.not.toBeInTheDocument();
	await userEvent.keyboard('{Escape}');
	await expect.element(screen.getByRole('dialog')).toBeVisible();
	expect(onremove).toHaveBeenCalledTimes(1);
	finish();
	await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
});
