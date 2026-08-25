import { describe, expect, it, vi } from 'vitest';
import { openBlobWriter } from './fs-primitives';
import { __resetKeyLocksForTesting } from './with-key-lock';

describe('workspace blob writer', () => {
	it('keeps one streaming writer per path until close or abort', async () => {
		__resetKeyLocksForTesting();
		const write = vi.fn(async () => undefined);
		const close = vi.fn(async () => undefined);
		const abort = vi.fn(async () => undefined);
		const createWritable = vi.fn(async () => ({ write, close, abort }));
		const directory = {
			getDirectoryHandle: vi.fn(async () => directory),
			getFileHandle: vi.fn(async () => ({ createWritable }))
		};
		// SAFETY: in-memory directory stub implements the FileSystemDirectoryHandle surface used by openBlobWriter.
		const root = directory as FileSystemDirectoryHandle;

		const first = await openBlobWriter(root, ['media', 'same-id', 'source.mp4']);
		const secondPending = openBlobWriter(root, ['media', 'same-id', 'source.mp4']);
		await Promise.resolve();
		expect(createWritable).toHaveBeenCalledOnce();

		await first.write(new Uint8Array([1, 2, 3]));
		await first.close();
		const second = await secondPending;
		expect(createWritable).toHaveBeenCalledTimes(2);
		await second.abort(new Error('test cleanup'));
		expect(write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
		expect(close).toHaveBeenCalledOnce();
		expect(abort).toHaveBeenCalledOnce();
	});
});
