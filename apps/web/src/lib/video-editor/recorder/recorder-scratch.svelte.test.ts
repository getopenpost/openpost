import { expect, it } from 'vitest';
import { createScratchSink } from './recorder-scratch';
import { ScratchWriter } from './scratch-writer';

it('persists ordered scratch chunks and releases the file for removal', async () => {
	const sink = await createScratchSink('camera', 'video/mp4');
	try {
		await Promise.all([
			sink.write(new Blob(['first'])),
			sink.write(new Blob(['second'])),
			sink.write(new Blob(['third']))
		]);
		expect(sink.durable).toBe(true);
		expect(await (await sink.getFile()).text()).toBe('firstsecondthird');
		expect(sink.bytes).toBe(16);
		await Promise.all([sink.close(), sink.discard()]);
		await expect(sink.write(new Blob(['late']))).rejects.toThrow('Sink closed');
	} finally {
		await sink.discard();
	}
	const root = await navigator.storage.getDirectory();
	const directory = await root.getDirectoryHandle('recorder-scratch');
	await expect(directory.getFileHandle(sink.id)).rejects.toThrow();
});

it('keeps acknowledged bytes after a writer is terminated without closing', async () => {
	const root = await navigator.storage.getDirectory();
	const name = `recorder-crash-${crypto.randomUUID()}`;
	const handle = await root.getFileHandle(name, { create: true });
	const writer = new ScratchWriter();
	const resumed = new ScratchWriter();
	try {
		await writer.open(handle);
		await writer.write(new Blob(['durable prefix']));
		writer.terminate();
		await expect
			.poll(async () => {
				try {
					await resumed.open(handle);
					return true;
				} catch {
					return false;
				}
			})
			.toBe(true);
		expect(await (await handle.getFile()).text()).toBe('durable prefix');
		await resumed.write(new Blob([' and next chunk']));
		await resumed.close();
		expect(await (await handle.getFile()).text()).toBe('durable prefix and next chunk');
	} finally {
		writer.terminate();
		resumed.terminate();
		await root.removeEntry(name);
	}
});
