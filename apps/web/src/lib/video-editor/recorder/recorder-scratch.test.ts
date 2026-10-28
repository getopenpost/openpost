/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-runtime-typeof -- The OPFS test double implements the browser-owned methods exercised by recorder scratch storage. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScratchSink } from './recorder-scratch';

function installMemoryFallback(): void {
	vi.stubGlobal('navigator', { storage: {} });
}

describe('recorder scratch storage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('keeps concurrent fallback writes ordered and clears retained data on discard', async () => {
		installMemoryFallback();
		const sink = await createScratchSink('microphone', 'audio/webm');
		expect(sink.durable).toBe(false);
		await Promise.all([
			sink.write(new Blob(['first'])),
			sink.write(new Blob(['second'])),
			sink.write(new Blob(['third']))
		]);
		await sink.close();

		expect(sink.chunks).toBe(3);
		expect(sink.bytes).toBe(16);
		expect(await (await sink.getFile()).text()).toBe('firstsecondthird');
		await sink.discard();
		expect(sink.chunks).toBe(0);
		expect(sink.bytes).toBe(0);
	});

	it('writes OPFS chunks at explicit ordered offsets and removes the scratch file', async () => {
		const writes: Array<{ position: number; text: string }> = [];
		const close = vi.fn(async () => undefined);
		const removeEntry = vi.fn(async () => undefined);
		const fileHandle = {
			createWritable: vi.fn(async () => ({
				write: async (command: { position: number; data: Blob }) => {
					writes.push({
						position: command.position,
						text: await command.data.text()
					});
				},
				close
			})),
			getFile: vi.fn(
				async () =>
					new File(
						writes.map((write) => write.text),
						'scratch.webm'
					)
			)
		};
		const scratchDirectory = {
			getFileHandle: vi.fn(async () => fileHandle),
			removeEntry
		};
		const rootDirectory = {
			getDirectoryHandle: vi.fn(async () => scratchDirectory)
		};
		vi.stubGlobal('navigator', {
			storage: {
				getDirectory: vi.fn(async () => rootDirectory)
			}
		});

		const sink = await createScratchSink('camera', 'video/webm');
		expect(sink.durable).toBe(true);
		await Promise.all([
			sink.write(new Blob(['abc'])),
			sink.write(new Blob(['de'])),
			sink.write(new Blob(['fghi']))
		]);
		await sink.close();

		expect(writes).toEqual([
			{ position: 0, text: 'abc' },
			{ position: 3, text: 'de' },
			{ position: 5, text: 'fghi' }
		]);
		expect(await (await sink.getFile()).text()).toBe('abcdefghi');
		await sink.discard();
		expect(fileHandle.createWritable).toHaveBeenNthCalledWith(1, {
			keepExistingData: false
		});
		expect(fileHandle.createWritable).toHaveBeenNthCalledWith(2, {
			keepExistingData: true
		});
		expect(fileHandle.createWritable).toHaveBeenNthCalledWith(3, {
			keepExistingData: true
		});
		expect(close).toHaveBeenCalledTimes(3);
		expect(removeEntry).toHaveBeenCalledWith(sink.id);
	});
});
