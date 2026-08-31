import { StreamTarget, type StreamTargetChunk } from 'mediabunny';
import type { OpenPostFileSystemDirectoryHandle } from '$lib/browser-capabilities';

const TEMP_DIRECTORY = 'openpost-video-streams';
const STALE_AGE_MS = 24 * 60 * 60 * 1_000;

export interface StreamingOutputTarget {
	target: StreamTarget;
	file(name: string, mimeType: string): Promise<File>;
	discard(): Promise<void>;
	storageKey: string | null;
	readonly bytesWritten: number;
}

export interface StreamingFileWritable {
	write(data: FileSystemWriteChunkType): Promise<void>;
	close(): Promise<void>;
	abort(reason?: Error): Promise<void>;
}

export interface StreamingWritableLifecycle {
	writable: WritableStream<StreamTargetChunk>;
	file(name: string, mimeType: string): Promise<File>;
	discard(): Promise<void>;
	readonly bytesWritten: number;
}

export async function createFileSystemAccessOutputTarget(
	handle: FileSystemFileHandle,
	signal?: AbortSignal
): Promise<StreamingOutputTarget> {
	const fileWritable = await handle.createWritable();
	return createWritableOutputTarget(
		fileWritable,
		async () => await handle.getFile(),
		async () => {
			// A user-selected file cannot be removed through File System Access. Aborting
			// leaves the previous file contents intact and discards staged changes.
		},
		signal,
		null
	);
}

export async function createStreamingOutputTarget(
	signal?: AbortSignal
): Promise<StreamingOutputTarget> {
	const getDirectory = navigator.storage?.getDirectory;
	if (!getDirectory) {
		throw new Error('This browser cannot stream video output to local storage.');
	}
	const root = await getDirectory.call(navigator.storage);
	const directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
	void cleanStaleStreamingOutputs(directory);
	const fileName = `render-${Date.now()}-${crypto.randomUUID()}.partial`;
	const handle = await directory.getFileHandle(fileName, { create: true });
	const fileWritable = await handle.createWritable();
	return createWritableOutputTarget(
		fileWritable,
		async () => await handle.getFile(),
		async () => await directory.removeEntry(fileName).catch(() => undefined),
		signal,
		fileName
	);
}

export function createWritableOutputTarget(
	fileWritable: StreamingFileWritable,
	readFile: () => Promise<File>,
	removeFile: () => Promise<void>,
	signal: AbortSignal | undefined,
	storageKey: string | null
): StreamingOutputTarget {
	const lifecycle = createStreamingWritableLifecycle(fileWritable, readFile, removeFile, signal);
	return {
		target: new StreamTarget(lifecycle.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
		storageKey,
		get bytesWritten() {
			return lifecycle.bytesWritten;
		},
		file: lifecycle.file,
		discard: lifecycle.discard
	};
}

export function createStreamingWritableLifecycle(
	fileWritable: StreamingFileWritable,
	readFile: () => Promise<File>,
	removeFile: () => Promise<void>,
	signal?: AbortSignal
): StreamingWritableLifecycle {
	type TerminalState = 'open' | 'closing' | 'closed' | 'aborting' | 'failed';
	let state: TerminalState = 'open';
	let hasFailure = false;
	let failure: Error;
	let terminalPromise: Promise<void> | null = null;
	let bytesWritten = 0;
	let resolveTerminal!: () => void;
	const terminal = new Promise<void>((resolve) => {
		resolveTerminal = resolve;
	});

	const toFailure = (cause: unknown): Error => {
		if (cause instanceof Error) return cause;
		return new Error(String(cause ?? 'Streaming output failed.'));
	};

	const rememberFailure = (reason: Error): void => {
		if (hasFailure) return;
		hasFailure = true;
		failure = reason;
	};

	const finishTerminal = (): void => {
		signal?.removeEventListener('abort', onSignalAbort);
		resolveTerminal();
	};

	const abortWritable = (reason: Error): Promise<void> => {
		rememberFailure(reason);
		if (terminalPromise) return terminalPromise;
		if (state === 'closed') {
			finishTerminal();
			return Promise.resolve();
		}
		state = 'aborting';
		terminalPromise = fileWritable
			.abort(reason)
			.catch((cause: unknown) => rememberFailure(toFailure(cause)))
			.then(() => {
				state = 'failed';
				finishTerminal();
			});
		return terminalPromise;
	};

	function onSignalAbort(): void {
		void abortWritable(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
	}

	const writable = new WritableStream<StreamTargetChunk>({
		async write(chunk) {
			if (state !== 'open') {
				throw hasFailure ? failure : new Error('The output is no longer writable.');
			}
			try {
				signal?.throwIfAborted();
				await fileWritable.write({ type: 'write', position: chunk.position, data: chunk.data });
				bytesWritten = Math.max(bytesWritten, chunk.position + chunk.data.byteLength);
			} catch (cause) {
				const failure = toFailure(cause);
				await abortWritable(failure);
				throw failure;
			}
		},
		async close() {
			if (terminalPromise) {
				await terminalPromise;
				if (hasFailure) throw failure;
				return;
			}
			try {
				signal?.throwIfAborted();
			} catch (cause) {
				const failure = toFailure(cause);
				await abortWritable(failure);
				throw failure;
			}
			state = 'closing';
			terminalPromise = fileWritable
				.close()
				.then(() => {
					state = 'closed';
				})
				.catch((cause: unknown) => {
					rememberFailure(toFailure(cause));
					state = 'failed';
				})
				.then(finishTerminal);
			await terminalPromise;
			if (hasFailure) throw failure;
		},
		async abort(reason) {
			await abortWritable(toFailure(reason));
		}
	});
	signal?.addEventListener('abort', onSignalAbort, { once: true });
	if (signal?.aborted) onSignalAbort();

	let removalPromise: Promise<void> | null = null;
	const removeOnce = (): Promise<void> => {
		removalPromise ??= removeFile();
		return removalPromise;
	};

	return {
		writable,
		get bytesWritten() {
			return bytesWritten;
		},
		async file(name, mimeType) {
			await terminal;
			if (hasFailure) throw failure;
			const stored = await readFile();
			if (stored.size === 0) throw new Error('The video renderer produced an empty file.');
			if (stored.name === name && stored.type === mimeType) return stored;
			return new File([stored], name, { type: mimeType, lastModified: Date.now() });
		},
		async discard() {
			if (state === 'open') {
				await abortWritable(new DOMException('Discarded', 'AbortError'));
			} else if (terminalPromise) {
				await terminalPromise;
			}
			await removeOnce();
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
