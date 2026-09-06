import { describe, expect, it, vi } from 'vitest';
import { requestDestructiveAction, runDestructiveSequence } from './destructive-action';

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

	it('announces a Shift-bypassed failure once without running successful completion', async () => {
		const notify = vi.fn();
		const execute = vi.fn().mockResolvedValue({ ok: false, message: 'Could not delete post.' });

		await requestDestructiveAction({ shiftKey: true }, vi.fn(), execute, notify);

		expect(notify).toHaveBeenCalledWith('Could not delete post.', 'error');
	});
});

describe('runDestructiveSequence', () => {
	it('retries only unfinished targets after a partial failure', async () => {
		const completed: string[] = [];
		let failSecondTarget = true;
		const execute = async (target: string) => {
			if (target === 'schedule-2' && failSecondTarget) throw new Error('not deleted');
			completed.push(target);
		};

		const first = await runDestructiveSequence(['schedule-1', 'schedule-2', 'schedule-3'], execute);
		expect(first.remaining).toEqual(['schedule-2', 'schedule-3']);
		expect(completed).toEqual(['schedule-1']);

		failSecondTarget = false;
		const retry = await runDestructiveSequence(first.remaining, execute);
		expect(retry).toEqual({ remaining: [] });
		expect(completed).toEqual(['schedule-1', 'schedule-2', 'schedule-3']);
	});
});
