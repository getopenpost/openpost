/** Small versioned OPFS cache primitive for derived editor media. */
const CACHE_ROOT = 'openpost-video-cache-v1';

async function directory(
	parts: string[],
	create: boolean
): Promise<FileSystemDirectoryHandle | null> {
	try {
		let current = await navigator.storage.getDirectory();
		current = await current.getDirectoryHandle(CACHE_ROOT, { create });
		for (const part of parts) current = await current.getDirectoryHandle(safe(part), { create });
		return current;
	} catch {
		return null;
	}
}

export async function readOpfsBlob(kind: string, key: string, name: string): Promise<Blob | null> {
	try {
		const dir = await directory([kind, key], false);
		if (!dir) return null;
		return await (await dir.getFileHandle(safe(name))).getFile();
	} catch {
		return null;
	}
}

export async function writeOpfsBlob(
	kind: string,
	key: string,
	name: string,
	blob: Blob
): Promise<void> {
	const dir = await directory([kind, key], true);
	if (!dir) return;
	const handle = await dir.getFileHandle(safe(name), { create: true });
	const writable = await handle.createWritable();
	await writable.write(blob);
	await writable.close();
}

export async function removeOpfsEntry(kind: string, key: string): Promise<void> {
	try {
		const dir = await directory([kind], false);
		await dir?.removeEntry(safe(key), { recursive: true });
	} catch {
		/* Missing and unavailable caches are already clear. */
	}
}

function safe(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
