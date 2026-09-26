import { expect, it, vi } from 'vitest';
import {
	WorkspaceFileCorruptError,
	readJson,
	readArrayBuffer,
	writeJsonAtomic,
	writeBlob
} from './fs-primitives';

it.each(['json', 'bytes'])(
	'refreshes a %s snapshot invalidated by a concurrent write',
	async (kind) => {
		const storage = await navigator.storage.getDirectory();
		const name = `snapshot-race-${crypto.randomUUID()}`;
		const root = await storage.getDirectoryHandle(name, { create: true });
		const path = ['metadata.json'];
		await writeJsonAtomic(root, path, { version: 1 });
		const originalText = Blob.prototype.text;
		const originalArrayBuffer = Blob.prototype.arrayBuffer;
		const spy =
			kind === 'json'
				? vi.spyOn(Blob.prototype, 'text').mockImplementationOnce(async function (this: Blob) {
						await writeBlob(root, path, JSON.stringify({ version: 2 }));
						return originalText.call(this);
					})
				: vi
						.spyOn(Blob.prototype, 'arrayBuffer')
						.mockImplementationOnce(async function (this: Blob) {
							await writeBlob(root, path, JSON.stringify({ version: 2 }));
							return originalArrayBuffer.call(this);
						});
		try {
			const result =
				kind === 'json'
					? await readJson(root, path)
					: JSON.parse(new TextDecoder().decode((await readArrayBuffer(root, path))!));
			expect(result).toEqual({ version: 2 });
		} finally {
			spy.mockRestore();
			await storage.removeEntry(name, { recursive: true });
		}
	}
);

it('preserves corrupt metadata and stops retrying persistently unreadable files', async () => {
	const storage = await navigator.storage.getDirectory();
	const name = `snapshot-failure-${crypto.randomUUID()}`;
	const root = await storage.getDirectoryHandle(name, { create: true });
	try {
		await writeBlob(root, ['metadata.json'], '{invalid');
		await expect(readJson(root, ['metadata.json'])).rejects.toBeInstanceOf(
			WorkspaceFileCorruptError
		);
		await expect(readJson(root, ['missing.json'])).resolves.toBeNull();
		const error = new DOMException('Cannot read', 'NotReadableError');
		const spy = vi.spyOn(Blob.prototype, 'text').mockRejectedValue(error);
		try {
			await expect(readJson(root, ['metadata.json'])).rejects.toBe(error);
			expect(spy).toHaveBeenCalledTimes(3);
		} finally {
			spy.mockRestore();
		}
	} finally {
		await storage.removeEntry(name, { recursive: true });
	}
});

it('holds JSON replacements until an in-flight read has consumed its snapshot', async () => {
	const storage = await navigator.storage.getDirectory();
	const name = `snapshot-lock-${crypto.randomUUID()}`;
	const root = await storage.getDirectoryHandle(name, { create: true });
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	await writeJsonAtomic(root, ['metadata.json'], { version: 1 });
	const original = Blob.prototype.text;
	const spy = vi.spyOn(Blob.prototype, 'text').mockImplementationOnce(async function (this: Blob) {
		entered.resolve();
		await resume.promise;
		return original.call(this);
	});
	try {
		const read = readJson(root, ['metadata.json']);
		await entered.promise;
		const write = writeJsonAtomic(root, ['metadata.json'], { version: 2 });
		resume.resolve();
		await expect(read).resolves.toEqual({ version: 1 });
		await write;
		await expect(readJson(root, ['metadata.json'])).resolves.toEqual({ version: 2 });
	} finally {
		resume.resolve();
		spy.mockRestore();
		await storage.removeEntry(name, { recursive: true });
	}
});

it('surfaces permission loss immediately instead of treating it as missing metadata', async () => {
	const storage = await navigator.storage.getDirectory();
	const name = `snapshot-permission-${crypto.randomUUID()}`;
	const root = await storage.getDirectoryHandle(name, { create: true });
	const error = new DOMException('Access revoked', 'NotAllowedError');
	const spy = vi.spyOn(root, 'getFileHandle').mockRejectedValue(error);
	try {
		await expect(readJson(root, ['metadata.json'])).rejects.toBe(error);
		expect(spy).toHaveBeenCalledOnce();
	} finally {
		spy.mockRestore();
		await storage.removeEntry(name, { recursive: true });
	}
});
