import { describe, expect, it, vi } from 'vitest';
import { requestDestructiveAction } from './destructive-action';

describe('requestDestructiveAction', () => {
	it('requests confirmation for a normal activation', () => {
		const confirm = vi.fn();
		const execute = vi.fn();

		requestDestructiveAction({ shiftKey: false }, confirm, execute);

		expect(confirm).toHaveBeenCalledOnce();
		expect(execute).not.toHaveBeenCalled();
	});

	it('executes immediately for a Shift activation', async () => {
		const confirm = vi.fn();
		const notify = vi.fn();
		const execute = vi.fn().mockResolvedValue({
			ok: true,
			successMessage: 'Post deleted.'
		});

		await requestDestructiveAction({ shiftKey: true }, confirm, execute, notify);

		expect(execute).toHaveBeenCalledOnce();
		expect(confirm).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith('Post deleted.', 'success');
	});

	it('announces a Shift-bypassed failure exactly once and returns its outcome', async () => {
		const notify = vi.fn();
		const execute = vi.fn().mockResolvedValue({ ok: false, message: 'Could not delete post.' });

		const outcome = await requestDestructiveAction({ shiftKey: true }, vi.fn(), execute, notify);

		expect(notify).toHaveBeenCalledWith('Could not delete post.', 'error');
		expect(notify).toHaveBeenCalledOnce();
		expect(outcome).toEqual({ ok: false, message: 'Could not delete post.' });
	});
});
