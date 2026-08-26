import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScratchSink, isOpfsAvailable } from './recorder-scratch';

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

	it('bounds the memory fallback while preserving all accepted bytes', async () => {
		installMemoryFallback();
		const sink = await createScratchSink('screen', 'video/webm');
		const accepted = new Blob([new Uint8Array(24 * 1024 * 1024)]);
		await sink.write(accepted);
		await expect(sink.write(new Blob(['overflow']))).rejects.toMatchObject({
			name: 'QuotaExceededError'
		});
		await sink.close();
		expect((await sink.getFile()).size).toBe(accepted.size);
		await sink.discard();
	});

	it('writes OPFS chunks at explicit ordered offsets and removes the scratch file', async () => {
		const writes: Array<{ position: number; text: string }> = [];
		const close = vi.fn(async () => undefined);
		const removeEntry = vi.fn(async () => undefined);
		const fileHandle = {
			createWritable: vi.fn(async () => ({
				write: async (command: { position: number; data: Blob }) => {
					writes.push({ position: command.position, text: await command.data.text() });
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
		expect(close).toHaveBeenCalledOnce();
		expect(removeEntry).toHaveBeenCalledWith(sink.id);
	});

	it('reports OPFS only when the directory API exists', () => {
		installMemoryFallback();
		expect(isOpfsAvailable()).toBe(false);
		vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } });
		expect(isOpfsAvailable()).toBe(true);
	});
});
