import type { VideoSource } from '@openpost/video-project';
import { listProjectAssets, readProjectFile } from './storage';
import { openVideoProjectSource } from './source-access';

export interface VideoSourceURLLease {
	readonly url: string;
	release(): void;
}

interface ObjectURLEntry {
	url: string;
	references: number;
}

type ObjectURLFactory = {
	create(blob: Blob): string;
	revoke(url: string): void;
};

const browserObjectURLFactory: ObjectURLFactory = {
	create: (blob) => URL.createObjectURL(blob),
	revoke: (url) => URL.revokeObjectURL(url)
};

/**
 * Coalesces reads for one OPFS path and keeps its Blob URL alive until the last
 * editor-owned lease is released.
 */
export class ObjectURLLeasePool {
	private readonly entries = new Map<string, ObjectURLEntry>();
	private readonly pending = new Map<string, Promise<ObjectURLEntry>>();

	constructor(private readonly factory: ObjectURLFactory = browserObjectURLFactory) {}

	async acquire(key: string, load: () => Promise<Blob>): Promise<VideoSourceURLLease> {
		let entry = this.entries.get(key);
		if (!entry) {
			let pending = this.pending.get(key);
			if (!pending) {
				pending = load().then((blob) => {
					const created = { url: this.factory.create(blob), references: 0 };
					this.entries.set(key, created);
					return created;
				});
				this.pending.set(key, pending);
				const clearPending = () => {
					if (this.pending.get(key) === pending) this.pending.delete(key);
				};
				void pending.then(clearPending, clearPending);
			}
			entry = await pending;
		}

		entry.references += 1;
		let released = false;
		return {
			url: entry.url,
			release: () => {
				if (released) return;
				released = true;
				entry!.references -= 1;
				if (entry!.references > 0 || this.entries.get(key) !== entry) return;
				this.entries.delete(key);
				this.factory.revoke(entry!.url);
			}
		};
	}
}

/**
 * Owns one component slot. A replacement invalidates the previous generation
 * immediately, and a late result releases its lease instead of becoming visible.
 */
export class VideoSourceURLSlot {
	private generation = 0;
	private current: VideoSourceURLLease | undefined;
	private disposed = false;

	async replace(load: () => Promise<VideoSourceURLLease>): Promise<string | undefined> {
		if (this.disposed) return undefined;
		const generation = ++this.generation;
		this.releaseCurrent();
		let lease: VideoSourceURLLease;
		try {
			lease = await load();
		} catch (cause) {
			if (this.disposed || generation !== this.generation) return undefined;
			throw cause;
		}
		if (this.disposed || generation !== this.generation) {
			lease.release();
			return undefined;
		}
		this.current = lease;
		return lease.url;
	}

	clear(): void {
		if (this.disposed) return;
		this.generation += 1;
		this.releaseCurrent();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.releaseCurrent();
	}

	private releaseCurrent(): void {
		this.current?.release();
		this.current = undefined;
	}
}

const localObjectURLs = new ObjectURLLeasePool();

export function createObjectURLLease(blob: Blob): VideoSourceURLLease {
	const url = browserObjectURLFactory.create(blob);
	let released = false;
	return {
		url,
		release: () => {
			if (released) return;
			released = true;
			browserObjectURLFactory.revoke(url);
		}
	};
}

export async function acquireVideoSourceURL(
	source: VideoSource,
	projectID?: string,
	preferProxy = false,
	cacheRevision: string | number = source.content_hash ?? source.size_bytes
): Promise<VideoSourceURLLease> {
	if (source.locator.type !== 'local-opfs') {
		return staticURLLease(`/media/${encodeURIComponent(source.locator.media_id)}`);
	}

	if (preferProxy && projectID && source.kind !== 'image' && source.kind !== 'audio') {
		const proxy = (await listProjectAssets(projectID, source.id)).find(
			(asset) => asset.kind === 'proxy'
		);
		if (proxy) {
			try {
				return await acquireLocalFileURL(proxy.path, source.original_name, cacheRevision);
			} catch (cause) {
				if (!(cause instanceof MissingLocalVideoFileError)) throw cause;
				// An interrupted cache write may leave an index row without a file.
				// Fall back to the source while the artifact worker repairs the proxy.
			}
		}
	}

	return await acquireLocalFileURL(source.locator.path, source.original_name, cacheRevision);
}

async function acquireLocalFileURL(
	path: string,
	originalName: string,
	cacheRevision: string | number
): Promise<VideoSourceURLLease> {
	return await localObjectURLs.acquire(`${path}\u0000${cacheRevision}`, async () => {
		const file = await readProjectFile(path);
		if (!file) throw new MissingLocalVideoFileError(originalName);
		return file;
	});
}

function staticURLLease(url: string): VideoSourceURLLease {
	return { url, release: () => undefined };
}

class MissingLocalVideoFileError extends Error {
	constructor(originalName: string) {
		super(`${originalName} is missing from local project storage.`);
		this.name = 'MissingLocalVideoFileError';
	}
}

export async function openVideoProjectPreviewSource(
	projectID: string | undefined,
	source: VideoSource,
	signal?: AbortSignal
): Promise<{ file: File; using_proxy: boolean }> {
	if (projectID && source.kind !== 'image' && source.kind !== 'audio') {
		const proxy = (await listProjectAssets(projectID, source.id)).find(
			(asset) => asset.kind === 'proxy'
		);
		if (proxy) {
			const file = await readProjectFile(proxy.path);
			if (file) return { file, using_proxy: true };
		}
	}
	return {
		file: await openVideoProjectSource(projectID, source, signal),
		using_proxy: false
	};
}
