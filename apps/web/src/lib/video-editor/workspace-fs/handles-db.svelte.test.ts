import { expect, it, vi } from 'vitest';
import { deleteHandle, getHandle, saveHandle } from '@openpost/editor-shared/workspace';
it('reopens a closed handle database before writing without losing existing handles', async () => {
	const id = crypto.randomUUID();
	const handle = await navigator.storage.getDirectory();
	const record = {
		kind: 'project-folder' as const,
		id,
		handle,
		name: 'Before',
		pickedAt: 1
	};
	await saveHandle(record);
	const transaction = IDBDatabase.prototype.transaction;
	const closing = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function (
		this: IDBDatabase,
		...args
	) {
		this.close();
		return transaction.apply(this, args);
	});
	try {
		await saveHandle({ ...record, name: 'After' });
		expect((await getHandle('project-folder', id))?.name).toBe('After');
		expect(closing).toHaveBeenCalled();
	} finally {
		closing.mockRestore();
		await deleteHandle('project-folder', id);
	}
});

it('recovers a stale-transaction read without reporting an error', async () => {
	const id = crypto.randomUUID();
	const handle = await navigator.storage.getDirectory();
	await saveHandle({ kind: 'project-folder', id, handle, name: 'Before', pickedAt: 1 });
	// Simulate a versionchange-closed connection: the next transaction throws
	// InvalidStateError, so the read must reopen once and succeed quietly.
	const stale = vi
		.spyOn(IDBDatabase.prototype, 'transaction')
		.mockImplementationOnce(function (this: IDBDatabase) {
			throw new DOMException('Stale connection', 'InvalidStateError');
		});
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		expect((await getHandle('project-folder', id))?.name).toBe('Before');
		expect(stale).toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
	} finally {
		stale.mockRestore();
		consoleError.mockRestore();
		await deleteHandle('project-folder', id);
	}
});
