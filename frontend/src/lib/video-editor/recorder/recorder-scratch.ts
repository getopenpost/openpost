import { createLogger } from '../workspace-fs/logger';

const logger = createLogger('RecorderScratch');

const SCRATCH_DIR_NAME = 'recorder-scratch';
const MAX_FALLBACK_CHUNKS = 7_200;
const MAX_FALLBACK_BYTES = 24 * 1024 * 1024;

export type ScratchKind = 'screen' | 'camera' | 'microphone';

export interface ScratchSink {
	readonly id: string;
	readonly kind: ScratchKind;
	readonly mimeType: string;
	write(chunk: Blob): Promise<void>;
	close(): Promise<void>;
	getFile(): Promise<File>;
	discard(): Promise<void>;
	get bytes(): number;
	get chunks(): number;
}

interface OpfsStorageManager extends StorageManager {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
}

class OpfsSink implements ScratchSink {
	readonly id: string;
	readonly kind: ScratchKind;
	readonly mimeType: string;
	private handle: FileSystemFileHandle | null = null;
	private writable: FileSystemWritableFileStream | null = null;
	private offset = 0;
	private _bytes = 0;
	private _chunks = 0;
	private queue: Promise<void> = Promise.resolve();
	private closed = false;
	private dirHandle: FileSystemDirectoryHandle | null = null;

	constructor(
		id: string,
		kind: ScratchKind,
		mimeType: string,
		dirHandle: FileSystemDirectoryHandle,
		handle: FileSystemFileHandle,
		writable: FileSystemWritableFileStream
	) {
		this.id = id;
		this.kind = kind;
		this.mimeType = mimeType;
		this.dirHandle = dirHandle;
		this.handle = handle;
		this.writable = writable;
	}

	get bytes(): number {
		return this._bytes;
	}

	get chunks(): number {
		return this._chunks;
	}

	write(chunk: Blob): Promise<void> {
		if (this.closed) return Promise.reject(new Error('Sink closed'));
		if (chunk.size === 0) return Promise.resolve();
		const task = this.queue.then(async () => {
			if (!this.writable) throw new Error('Writable missing');
			// SAFETY: FileSystemWritableFileStream write at boundary
			await this.writable.write({ type: 'write', position: this.offset, data: chunk });
			this.offset += chunk.size;
			this._bytes += chunk.size;
			this._chunks += 1;
		});
		// keep chain alive even if one write fails
		this.queue = task.catch(() => {});
		return task;
	}

	async close(): Promise<void> {
		await this.queue;
		if (this.writable && !this.closed) {
			this.closed = true;
			await this.writable.close();
			this.writable = null;
		}
	}

	async getFile(): Promise<File> {
		await this.queue;
		if (!this.handle) throw new Error('Missing handle');
		const file = await this.handle.getFile();
		// Return as File with correct mime
		return new File([file], `${this.id}.${this.kind}.webm`, {
			type: this.mimeType || file.type,
			lastModified: Date.now()
		});
	}

	async discard(): Promise<void> {
		try {
			await this.queue;
		} catch {
			// ignore
		}
		if (this.writable && !this.closed) {
			try {
				await this.writable.close();
			} catch {
				// ignore
			}
			this.writable = null;
			this.closed = true;
		}
		if (this.dirHandle && this.handle) {
			try {
				await this.dirHandle.removeEntry(this.id);
			} catch (error) {
				logger.warn('discard failed', error);
			}
		}
		this.handle = null;
		this.dirHandle = null;
	}
}

class MemoryFallbackSink implements ScratchSink {
	readonly id: string;
	readonly kind: ScratchKind;
	readonly mimeType: string;
	private parts: Blob[] = [];
	private _bytes = 0;
	private _chunks = 0;
	private queue: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(id: string, kind: ScratchKind, mimeType: string) {
		this.id = id;
		this.kind = kind;
		this.mimeType = mimeType;
	}

	get bytes(): number {
		return this._bytes;
	}

	get chunks(): number {
		return this._chunks;
	}

	write(chunk: Blob): Promise<void> {
		if (this.closed) return Promise.reject(new Error('Sink closed'));
		if (chunk.size === 0) return Promise.resolve();
		const task = this.queue.then(() => {
			if (this._chunks >= MAX_FALLBACK_CHUNKS || this._bytes + chunk.size > MAX_FALLBACK_BYTES) {
				throw new DOMException('Storage limit exceeded', 'QuotaExceededError');
			}
			this.parts.push(chunk);
			this._bytes += chunk.size;
			this._chunks += 1;
		});
		this.queue = task.catch(() => {});
		return task;
	}

	async close(): Promise<void> {
		await this.queue;
		this.closed = true;
	}

	async getFile(): Promise<File> {
		await this.queue;
		// Memory fallback still returns a File assembled from bounded parts.
		// This is bounded by MAX_FALLBACK_* so never unbounded.
		const blob = new Blob(this.parts, { type: this.mimeType });
		return new File([blob], `${this.id}.${this.kind}.webm`, {
			type: this.mimeType,
			lastModified: Date.now()
		});
	}

	async discard(): Promise<void> {
		try {
			await this.queue;
		} catch {
			// ignore
		}
		this.parts = [];
		this._bytes = 0;
		this._chunks = 0;
		this.closed = true;
	}
}

async function getOpfsDir(): Promise<FileSystemDirectoryHandle | null> {
	// SAFETY: Some supported browsers expose the standard OPFS method before TypeScript's DOM types do.
	const storage = globalThis.navigator?.storage as OpfsStorageManager | undefined;
	if (!storage?.getDirectory) return null;
	try {
		const root = await storage.getDirectory();
		const dir = await root.getDirectoryHandle(SCRATCH_DIR_NAME, { create: true });
		return dir;
	} catch {
		return null;
	}
}

export async function createScratchSink(kind: ScratchKind, mimeType: string): Promise<ScratchSink> {
	const dir = await getOpfsDir();
	if (dir) {
		try {
			const id = `${kind}-${crypto.randomUUID()}`;
			const handle = await dir.getFileHandle(id, { create: true });
			const writable = await handle.createWritable();
			return new OpfsSink(id, kind, mimeType, dir, handle, writable);
		} catch (error) {
			logger.warn('OPFS sink creation failed, falling back to memory', error);
		}
	}
	// Fallback bounded memory
	const fallbackId = `${kind}-${crypto.randomUUID()}-mem`;
	return new MemoryFallbackSink(fallbackId, kind, mimeType);
}

export async function discardScratchById(id: string): Promise<void> {
	const dir = await getOpfsDir();
	if (dir) {
		try {
			await dir.removeEntry(id);
			return;
		} catch {
			// not found or already removed
		}
	}
	// Memory fallback ids are not persisted, nothing to delete on disk
}

export function isOpfsAvailable(): boolean {
	// SAFETY: Some supported browsers expose the standard OPFS method before TypeScript's DOM types do.
	const storage = globalThis.navigator?.storage as OpfsStorageManager | undefined;
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- capability probe at the browser boundary
	return typeof storage?.getDirectory === 'function';
}
