import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CopyButton from './copy-button.svelte';

describe('copy feedback', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});
	it('only confirms a completed clipboard write and offers retry on failure', async () => {
		let finish!: () => void;
		vi.spyOn(document, 'execCommand').mockReturnValue(false);
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
			errorMessage: 'Copy the link manually.',
			fallbackLabel: 'Text to copy'
		});
		await screen.getByRole('button', { name: 'Copy', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Copy', exact: true }))
			.toHaveAttribute('aria-busy', 'true');
		// Keep the temporary success label visible while browser assertions run.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		finish();
		await expect.element(screen.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
		expect(write).toHaveBeenCalledWith('sample invitation');
		await screen.getByRole('button', { name: 'Copied', exact: true }).click();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Copy the link manually.');
		await expect
			.element(screen.getByRole('textbox', { name: 'Text to copy' }))
			.toHaveValue('sample invitation');
		await expect
			.element(screen.getByRole('button', { name: 'Try again', exact: true }))
			.toBeVisible();
	});
	it('ignores a clipboard result after its workspace or value changes', async () => {
		const writes: Array<{ promise: Promise<void>; settle: () => void }> = [];
		const write = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => {
			let settle!: () => void;
			const promise = new Promise<void>((resolve) => {
				settle = resolve;
			});
			writes.push({ promise, settle });
			return promise;
		});
		const props = {
			value: 'first link',
			scopeKey: 'workspace-1',
			errorMessage: 'Copy manually.'
		};

		async function expectLateWriteIgnored(change: { value: string; scopeKey: string }) {
			const screen = await render(CopyButton, props);
			await screen.getByRole('button', { name: 'Copy', exact: true }).click();
			await expect
				.element(screen.getByRole('button', { name: 'Copy', exact: true }))
				.toHaveAttribute('aria-busy', 'true');
			const pending = writes[writes.length - 1];
			expect(pending).toBeDefined();
			await screen.rerender({ ...props, ...change });
			pending!.settle();
			// Rerender alone resets the keyed control to idle, so settlement is the
			// pending write promise plus a macrotask, not the busy attribute.
			await pending!.promise;
			await new Promise((resolve) => setTimeout(resolve, 0));
			// Retrying matchers can poll a transient late success away after the
			// change effect resets the control; assert the settled instant instead.
			expect(screen.container.querySelector('[role=status]')?.textContent).toBe('');
			await expect
				.element(screen.getByRole('button', { name: 'Copy', exact: true }))
				.toHaveAttribute('aria-busy', 'false');
			await screen.unmount();
		}

		// The original combined change first, then each invalidation input on its own
		// so removing one dependency stays detectable.
		await expectLateWriteIgnored({ value: 'second link', scopeKey: 'workspace-2' });
		await expectLateWriteIgnored({ value: 'second link', scopeKey: 'workspace-1' });
		await expectLateWriteIgnored({ value: 'first link', scopeKey: 'workspace-2' });
		expect(write).toHaveBeenCalledTimes(3);
		expect(write).toHaveBeenNthCalledWith(1, 'first link');
		expect(write).toHaveBeenNthCalledWith(2, 'first link');
		expect(write).toHaveBeenNthCalledWith(3, 'first link');
	});
});
