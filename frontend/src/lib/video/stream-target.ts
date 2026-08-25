import { StreamTarget, type StreamTargetChunk } from 'mediabunny';
import type { OpenPostFileSystemDirectoryHandle } from '$lib/browser-capabilities';
import { STREAMING_TEMP_DIRECTORY } from '$lib/video-editor/media/streaming-limits';

const TEMP_DIRECTORY = STREAMING_TEMP_DIRECTORY;
const STALE_AGE_MS = 24 * 60 * 60 * 1_000;

export interface StreamingOutputTarget {
	target: StreamTarget;
	scratchFileName: string;
	scratchPath: string;
	file(name: string, mimeType: string): Promise<File>;
	discard(): Promise<void>;
}

export async function discardStreamingScratch(scratchFileName: string): Promise<void> {
	const getDirectory = globalThis.navigator?.storage?.getDirectory;
	if (!getDirectory) return;
	try {
		const root = await getDirectory.call(globalThis.navigator.storage);
		const directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: false });
		await directory.removeEntry(scratchFileName).catch(() => undefined);
	} catch {
		// Scratch cleanup is best-effort; workspace copy already succeeded.
	}
}

export async function createFileSystemAccessOutputTarget(
	handle: FileSystemFileHandle,
	signal?: AbortSignal
): Promise<StreamingOutputTarget> {
	const fileWritable = await handle.createWritable();
	const base = outputTargetFromWritable(
		fileWritable,
		async () => await handle.getFile(),
		async () => {
			// A user-selected file cannot be removed through File System Access. Aborting
			// leaves the previous file contents intact and discards staged changes.
		},
		signal
	);
	return {
		...base,
		scratchFileName: '',
		scratchPath: ''
	};
}

export async function createStreamingOutputTarget(
	signal?: AbortSignal
): Promise<StreamingOutputTarget> {
	const getDirectory = globalThis.navigator?.storage?.getDirectory;
	if (!getDirectory) {
		throw new Error('This browser cannot stream video output to local storage.');
	}
	const root = await getDirectory.call(globalThis.navigator.storage);
	const directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
	void cleanStaleStreamingOutputs(directory);
	const fileName = `render-${Date.now()}-${crypto.randomUUID()}.partial`;
	const handle = await directory.getFileHandle(fileName, { create: true });
	const fileWritable = await handle.createWritable();
	const base = outputTargetFromWritable(
		fileWritable,
		async () => await handle.getFile(),
		async () => await directory.removeEntry(fileName).catch(() => undefined),
		signal
	);
	return {
		...base,
		scratchFileName: fileName,
		scratchPath: `${TEMP_DIRECTORY}/${fileName}`
	};
}

function outputTargetFromWritable(
	fileWritable: FileSystemWritableFileStream,
	readFile: () => Promise<File>,
	removeFile: () => Promise<void>,
	signal?: AbortSignal
): Omit<StreamingOutputTarget, 'scratchFileName' | 'scratchPath'> {
	let closed = false;
	let failed: unknown;
	let resolveClosed!: () => void;
	const closedPromise = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const writable = new WritableStream<StreamTargetChunk>({
		async write(chunk) {
			signal?.throwIfAborted();
			try {
				await fileWritable.write({ type: 'write', position: chunk.position, data: chunk.data });
			} catch (cause) {
				failed ??= cause;
				throw cause;
			}
		},
		async close() {
			try {
				await fileWritable.close();
				closed = true;
				resolveClosed();
			} catch (cause) {
				failed ??= cause;
				resolveClosed();
				// Mediabunny may close a target while its writable is already errored.
				// Keep the original failure available through file(), but do not turn
				// cancellation cleanup into an unhandled rejection.
			}
		},
		async abort(reason) {
			failed ??= reason;
			try {
				await fileWritable.abort(reason);
			} finally {
				resolveClosed();
			}
		}
	});
	const abort = () => void fileWritable.abort(signal?.reason);
	signal?.addEventListener('abort', abort, { once: true });

	return {
		target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
		async file(name, mimeType) {
			if (!closed && !failed) await closedPromise;
			if (failed) throw failed;
			const stored = await readFile();
			if (stored.size === 0) throw new Error('The video renderer produced an empty file.');
			signal?.removeEventListener('abort', abort);
			if (stored.name === name && stored.type === mimeType) return stored;
			return new File([stored], name, { type: mimeType, lastModified: Date.now() });
		},
		async discard() {
			signal?.removeEventListener('abort', abort);
			if (!closed) {
				try {
					await fileWritable.abort(new DOMException('Discarded', 'AbortError'));
				} catch {
					// The output may already have been cancelled by Mediabunny.
				}
			}
			await removeFile();
		}
	};
}

async function cleanStaleStreamingOutputs(
	directory: OpenPostFileSystemDirectoryHandle
): Promise<void> {
	const cutoff = Date.now() - STALE_AGE_MS;
	try {
		for await (const [name, entry] of directory.entries()) {
			if (entry.kind !== 'file') continue;
			const file = await directory.getFileHandle(name).then((handle) => handle.getFile());
			if (file.lastModified < cutoff) await directory.removeEntry(name);
		}
	} catch {
		// Cleanup is opportunistic and must never interrupt an edit.
	}
}
