/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-runtime-typeof -- The OPFS test double implements the browser-owned methods exercised by recorder scratch storage. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createScratchSink,
	discardScratchRecoverySession,
	isOpfsAvailable,
	loadRecoverableScratchSessions,
	writeScratchRecoveryManifest,
	type ScratchRecoveryManifest
} from './recorder-scratch';

function installMemoryFallback(): void {
	vi.stubGlobal('navigator', { storage: {} });
}

interface RecoverableOpfsTestHarness {
	files: Map<string, Blob>;
	failRemovals: Set<string>;
}

function installRecoverableOpfs(): RecoverableOpfsTestHarness {
	const files = new Map<string, Blob>();
	const failRemovals = new Set<string>();
	const handles = new Map<string, FileSystemFileHandle>();
	const getHandle = (name: string): FileSystemFileHandle => {
		const existing = handles.get(name);
		if (existing) return existing;
		const handle = {
			kind: 'file',
			name,
			getFile: vi.fn(async () => {
				const blob = files.get(name);
				if (!blob) throw new DOMException('Missing', 'NotFoundError');
				return new File([blob], name, { type: blob.type, lastModified: 1_000 });
			}),
			createWritable: vi.fn(async (options?: FileSystemCreateWritableOptions) => {
				const existing = options?.keepExistingData ? files.get(name) : undefined;
				let pending = existing ? new Uint8Array(await existing.arrayBuffer()) : new Uint8Array();
				return {
					write: async (value: FileSystemWriteChunkType) => {
						if (typeof value === 'object' && value !== null && 'type' in value) {
							const command = value as {
								position?: number;
								data?: Blob | string;
							};
							const bytes = new Uint8Array(await new Response(command.data ?? '').arrayBuffer());
							const position = command.position ?? 0;
							const next = new Uint8Array(Math.max(pending.length, position + bytes.length));
							next.set(pending);
							next.set(bytes, position);
							pending = next;
							return;
						}
						pending = new Uint8Array(await new Response(value as Blob | string).arrayBuffer());
					},
					close: async () => {
						files.set(name, new Blob([pending]));
					},
					abort: async () => undefined
				};
			})
		} as unknown as FileSystemFileHandle;
		handles.set(name, handle);
		return handle;
	};
	const scratchDirectory = {
		kind: 'directory',
		name: 'recorder-scratch',
		getFileHandle: vi.fn(async (name: string, options?: FileSystemGetFileOptions) => {
			if (!files.has(name) && !handles.has(name) && !options?.create) {
				throw new DOMException('Missing', 'NotFoundError');
			}
			return getHandle(name);
		}),
		removeEntry: vi.fn(async (name: string) => {
			if (failRemovals.has(name)) throw new DOMException('Busy', 'InvalidModificationError');
			if (!files.delete(name) && !handles.has(name)) {
				throw new DOMException('Missing', 'NotFoundError');
			}
			handles.delete(name);
		}),
		async *entries() {
			for (const name of files.keys()) yield [name, getHandle(name)] as const;
		}
	};
	const rootDirectory = {
		getDirectoryHandle: vi.fn(async () => scratchDirectory)
	};
	vi.stubGlobal('navigator', {
		storage: { getDirectory: vi.fn(async () => rootDirectory) }
	});
	return { files, failRemovals };
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

	it('reports OPFS only when the directory API exists', () => {
		installMemoryFallback();
		expect(isOpfsAvailable()).toBe(false);
		vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } });
		expect(isOpfsAvailable()).toBe(true);
	});

	it('rebuilds flushed multi-source chunks without a graceful sink close', async () => {
		const { files, failRemovals } = installRecoverableOpfs();
		const sessionId = 'session-123';
		const screen = await createScratchSink('screen', 'video/webm', sessionId);
		const microphone = await createScratchSink('microphone', 'audio/webm', sessionId);
		await screen.write(new Blob(['screen-']));
		await screen.write(new Blob(['data']));
		await microphone.write(new Blob(['microphone-data']));
		const manifest: ScratchRecoveryManifest = {
			version: 1,
			sessionId,
			createdAt: 1_000,
			status: 'recording',
			artifacts: [
				{
					scratchId: screen.id,
					kind: 'screen',
					mimeType: 'video/webm',
					startOffsetMs: 0,
					durationMs: 2_000,
					sizeBytes: screen.bytes
				},
				{
					scratchId: microphone.id,
					kind: 'microphone',
					mimeType: 'audio/webm',
					startOffsetMs: 75,
					durationMs: 1_925,
					sizeBytes: microphone.bytes
				}
			]
		};
		await writeScratchRecoveryManifest(manifest);

		const recovered = await loadRecoverableScratchSessions();

		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.manifest).toEqual(manifest);
		expect(
			recovered[0]?.artifacts.map(({ kind, startOffsetMs, durationMs, sizeBytes }) => ({
				kind,
				startOffsetMs,
				durationMs,
				sizeBytes
			}))
		).toEqual([
			{ kind: 'screen', startOffsetMs: 0, durationMs: 2_000, sizeBytes: 11 },
			{
				kind: 'microphone',
				startOffsetMs: 75,
				durationMs: 1_925,
				sizeBytes: 15
			}
		]);
		expect(await recovered[0]?.artifacts[0]?.blob.text()).toBe('screen-data');
		expect(await recovered[0]?.artifacts[1]?.blob.text()).toBe('microphone-data');

		failRemovals.add(screen.id);
		await discardScratchRecoverySession(sessionId);
		expect(files.has(`capture-${sessionId}.json`)).toBe(true);
		expect((await loadRecoverableScratchSessions())[0]?.artifacts).toHaveLength(1);

		failRemovals.delete(screen.id);
		await discardScratchRecoverySession(sessionId);
		expect(files.size).toBe(0);
		expect(await loadRecoverableScratchSessions()).toEqual([]);
	});
});
