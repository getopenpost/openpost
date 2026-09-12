import { describe, expect, it, vi } from 'vitest';
import { openBlobWriter } from './fs-primitives';
import { __resetKeyLocksForTesting } from './with-key-lock';

describe('workspace blob writer', () => {
	it('keeps one streaming writer per path until close or abort', async () => {
		__resetKeyLocksForTesting();
		const write = vi.fn(async () => undefined);
		const close = vi.fn(async () => undefined);
		const abort = vi.fn(async () => undefined);
		const createWritable = vi.fn(async () =>
			Object.assign(new WritableStream(), {
				write,
				close,
				abort,
				seek: vi.fn(async () => undefined),
				truncate: vi.fn(async () => undefined)
			})
		);
		const file: FileSystemFileHandle = {
			kind: 'file',
			name: 'source.mp4',
			getFile: async () => new File([], 'source.mp4'),
			createWritable,
			async createSyncAccessHandle() {
				throw new Error('Unexpected synchronous file access');
			},
			isSameEntry: async (other) => other === file
		};
		const directory: FileSystemDirectoryHandle = {
			kind: 'directory',
			name: 'root',
			getDirectoryHandle: vi.fn(async () => directory),
			getFileHandle: vi.fn(async () => file),
			removeEntry: vi.fn(async () => undefined),
			resolve: vi.fn(async () => null),
			isSameEntry: async (other) => other === directory,
			queryPermission: async (): Promise<PermissionState> => 'granted',
			requestPermission: async (): Promise<PermissionState> => 'granted',
			async *entries() {},
			async *values() {}
		};
		const root = directory;

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
