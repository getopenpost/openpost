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
		const execute = vi.fn().mockResolvedValue(undefined);

		await requestDestructiveAction({ shiftKey: true }, confirm, execute);

		expect(execute).toHaveBeenCalledOnce();
		expect(confirm).not.toHaveBeenCalled();
	});
});
