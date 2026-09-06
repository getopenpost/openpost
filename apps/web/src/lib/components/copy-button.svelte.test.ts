import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CopyButton from './copy-button.svelte';

describe('copy feedback', () => {
	afterEach(() => vi.restoreAllMocks());
	it('only confirms a completed clipboard write and offers retry on failure', async () => {
		let finish!: () => void;
		const write = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finish = resolve;
					})
			)
			.mockRejectedValueOnce(new Error('Denied'));
		const screen = await render(CopyButton, {
			value: 'sample invitation',
			scopeKey: 'workspace-1',
			errorMessage: 'Copy the link manually.'
		});
		await screen.getByRole('button', { name: 'Copy', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Copy', exact: true }))
			.toHaveAttribute('aria-busy', 'true');
		finish();
		await expect.element(screen.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
		expect(write).toHaveBeenCalledWith('sample invitation');
		await screen.getByRole('button', { name: 'Copied', exact: true }).click();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Copy the link manually.');
		await expect
			.element(screen.getByRole('button', { name: 'Try again', exact: true }))
			.toBeVisible();
	});
	it('ignores a clipboard result after its workspace or value changes', async () => {
		let finish!: () => void;
		vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		const props = { value: 'first link', scopeKey: 'workspace-1', errorMessage: 'Copy manually.' };
		const screen = await render(CopyButton, props);
		await screen.getByRole('button', { name: 'Copy', exact: true }).click();
		await screen.rerender({ ...props, value: 'second link', scopeKey: 'workspace-2' });
		finish();
		await expect
			.element(screen.getByRole('button', { name: 'Copy', exact: true }))
			.toHaveAttribute('aria-busy', 'false');
		await expect.element(screen.getByRole('status')).toHaveTextContent('');
	});
});
