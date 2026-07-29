import { StreamTarget, type StreamTargetChunk } from 'mediabunny';

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

const TEMP_DIRECTORY = 'openpost-video-streams';
const STALE_AGE_MS = 24 * 60 * 60 * 1_000;

export interface StreamingOutputTarget {
	target: StreamTarget;
	file(name: string, mimeType: string): Promise<File>;
	discard(): Promise<void>;
}

export async function createStreamingOutputTarget(
	signal?: AbortSignal
): Promise<StreamingOutputTarget> {
	const storage = navigator.storage as StorageManagerWithDirectory | undefined;
	if (!storage?.getDirectory) {
		throw new Error('This browser cannot stream video output to local storage.');
	}
	const root = await storage.getDirectory();
	const directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
	void cleanStaleStreamingOutputs(directory);
	const fileName = `render-${Date.now()}-${crypto.randomUUID()}.partial`;
	const handle = await directory.getFileHandle(fileName, { create: true });
	const fileWritable = await handle.createWritable();
	let closed = false;
	let failed: unknown;
	let resolveClosed!: () => void;
	const closedPromise = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});
	const writable = new WritableStream<StreamTargetChunk>({
		async write(chunk) {
			signal?.throwIfAborted();
			await fileWritable.write({ type: 'write', position: chunk.position, data: chunk.data });
		},
		async close() {
			try {
				await fileWritable.close();
				closed = true;
				resolveClosed();
			} catch (cause) {
				failed = cause;
				resolveClosed();
				throw cause;
			}
		},
		async abort(reason) {
			failed = reason;
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
		target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
		async file(name, mimeType) {
			if (!closed && !failed) await closedPromise;
			if (failed) throw failed;
			const stored = await handle.getFile();
			if (stored.size === 0) throw new Error('The video renderer produced an empty file.');
			signal?.removeEventListener('abort', abort);
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
			await directory.removeEntry(fileName).catch(() => undefined);
		}
	};
}

async function cleanStaleStreamingOutputs(directory: FileSystemDirectoryHandle): Promise<void> {
	const cutoff = Date.now() - STALE_AGE_MS;
	try {
		for await (const [name, entry] of (directory as DirectoryHandleWithEntries).entries()) {
			if (entry.kind !== 'file') continue;
			const file = await (entry as FileSystemFileHandle).getFile();
			if (file.lastModified < cutoff) await directory.removeEntry(name);
		}
	} catch {
		// Cleanup is opportunistic and must never interrupt an edit.
	}
}
