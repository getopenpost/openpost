export const MOSS_MODEL_STORE_ROOT = 'nano-reader-browser-model-store';
export const MOSS_MODEL_STORE_KEY = 'openpost-moss-tts-f52645-ceff0d';
export const MOSS_MODEL_FILE_COUNT = 16;
export const MOSS_MODEL_TOTAL_BYTES = 763_191_513;

export interface MossModelStorageSummary {
	supported: boolean;
	downloaded: boolean;
	entryCount: number;
	totalBytes: number;
	sizeStatus: 'exact' | 'partial' | 'unavailable';
}

function isNotFound(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotFoundError';
}

function hasBrowserManagedStorage(): boolean {
	// eslint-disable-next-line anti-slop/no-runtime-typeof -- this is the SSR boundary for an optional browser API.
	return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function modelDirectory(): Promise<FileSystemDirectoryHandle | null> {
	if (!hasBrowserManagedStorage()) {
		return null;
	}
	try {
		const origin = await navigator.storage.getDirectory();
		const root = await origin.getDirectoryHandle(MOSS_MODEL_STORE_ROOT);
		return await root.getDirectoryHandle(MOSS_MODEL_STORE_KEY);
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}

async function measureDirectory(
	directory: FileSystemDirectoryHandle
): Promise<{ entryCount: number; totalBytes: number }> {
	let entryCount = 0;
	let totalBytes = 0;
	for await (const [, entry] of directory.entries()) {
		if (entry.kind === 'file') {
			entryCount += 1;
			// SAFETY: The File System Access API kind discriminant identifies a file handle.
			totalBytes += (await (entry as FileSystemFileHandle).getFile()).size;
		} else {
			// SAFETY: The only remaining FileSystemHandle kind is directory.
			const nested = await measureDirectory(entry as FileSystemDirectoryHandle);
			entryCount += nested.entryCount;
			totalBytes += nested.totalBytes;
		}
	}
	return { entryCount, totalBytes };
}

export async function inspectMossModelStorage(): Promise<MossModelStorageSummary> {
	if (!hasBrowserManagedStorage()) {
		return {
			supported: false,
			downloaded: false,
			entryCount: 0,
			totalBytes: 0,
			sizeStatus: 'unavailable'
		};
	}
	const directory = await modelDirectory();
	if (!directory) {
		return {
			supported: true,
			downloaded: false,
			entryCount: 0,
			totalBytes: 0,
			sizeStatus: 'exact'
		};
	}
	const measured = await measureDirectory(directory);
	return {
		supported: true,
		downloaded: measured.entryCount > 0,
		...measured,
		sizeStatus:
			measured.entryCount === MOSS_MODEL_FILE_COUNT &&
			measured.totalBytes === MOSS_MODEL_TOTAL_BYTES
				? 'exact'
				: 'partial'
	};
}

export async function clearMossModelStorage(): Promise<boolean> {
	if (!hasBrowserManagedStorage()) {
		return false;
	}
	try {
		const origin = await navigator.storage.getDirectory();
		const root = await origin.getDirectoryHandle(MOSS_MODEL_STORE_ROOT);
		await root.removeEntry(MOSS_MODEL_STORE_KEY, { recursive: true });
		return true;
	} catch (error) {
		if (isNotFound(error)) return false;
		throw error;
	}
}
