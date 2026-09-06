import { createLogger } from '../workspace-fs/logger';

const logger = createLogger('RecorderScratch');

const SCRATCH_DIR_NAME = 'recorder-scratch';
const RECOVERY_MANIFEST_PREFIX = 'capture-';
const RECOVERY_MANIFEST_SUFFIX = '.json';
const RECOVERY_MANIFEST_VERSION = 1;
const MAX_RECOVERY_MANIFEST_BYTES = 64 * 1024;
const MAX_FALLBACK_CHUNKS = 7_200;
const MAX_FALLBACK_BYTES = 24 * 1024 * 1024;

export type ScratchKind = 'screen' | 'camera' | 'microphone';

export interface ScratchRecoveryArtifact {
	scratchId: string;
	kind: ScratchKind;
	mimeType: string;
	startOffsetMs: number;
	durationMs: number;
	sizeBytes: number;
}

export interface ScratchRecoveryManifest {
	version: typeof RECOVERY_MANIFEST_VERSION;
	sessionId: string;
	createdAt: number;
	status: 'recording' | 'complete';
	artifacts: ScratchRecoveryArtifact[];
}

export interface RecoveredScratchArtifact extends ScratchRecoveryArtifact {
	blob: File;
}

export interface RecoveredScratchSession {
	manifest: ScratchRecoveryManifest;
	artifacts: RecoveredScratchArtifact[];
}

export interface ScratchSink {
	readonly id: string;
	readonly kind: ScratchKind;
	readonly mimeType: string;
	readonly durable: boolean;
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
	readonly durable = true;
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
		handle: FileSystemFileHandle
	) {
		this.id = id;
		this.kind = kind;
		this.mimeType = mimeType;
		this.dirHandle = dirHandle;
		this.handle = handle;
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
			if (!this.handle) throw new Error('File handle missing');
			const writable = await this.handle.createWritable({
				keepExistingData: this.offset > 0
			});
			this.writable = writable;
			try {
				// SAFETY: FileSystemWritableFileStream write at the durable browser storage boundary.
				await writable.write({
					type: 'write',
					position: this.offset,
					data: chunk
				});
				await writable.close();
				this.writable = null;
				this.offset += chunk.size;
				this._bytes += chunk.size;
				this._chunks += 1;
			} catch (error) {
				try {
					await writable.abort();
				} catch {
					// The write error owns the failure.
				}
				this.writable = null;
				throw error;
			}
		});
		// keep chain alive even if one write fails
		this.queue = task.catch(() => {});
		return task;
	}

	async close(): Promise<void> {
		await this.queue;
		this.closed = true;
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
	readonly durable = false;
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
		const dir = await root.getDirectoryHandle(SCRATCH_DIR_NAME, {
			create: true
		});
		return dir;
	} catch {
		return null;
	}
}

function recoveryManifestName(sessionId: string): string {
	if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error('Invalid recorder recovery session ID');
	return `${RECOVERY_MANIFEST_PREFIX}${sessionId}${RECOVERY_MANIFEST_SUFFIX}`;
}

function recoveryLockName(sessionId: string): string {
	return `openpost-recorder:${sessionId}`;
}

export async function holdScratchRecoveryLock(sessionId: string): Promise<() => void> {
	recoveryManifestName(sessionId);
	const locks = globalThis.navigator?.locks;
	if (!locks) return () => undefined;
	let releaseLock = () => undefined;
	const held = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});
	let confirmLock = () => undefined;
	const acquired = new Promise<void>((resolve) => {
		confirmLock = resolve;
	});
	const request = locks.request(recoveryLockName(sessionId), async () => {
		confirmLock();
		await held;
	});
	void request.catch((error) => {
		confirmLock();
		logger.warn('Recorder recovery lock failed', error);
	});
	await acquired;
	return releaseLock;
}

async function hasLiveScratchRecoveryOwner(sessionId: string): Promise<boolean> {
	const locks = globalThis.navigator?.locks;
	if (!locks) return false;
	let liveOwner = false;
	await locks.request(
		recoveryLockName(sessionId),
		{ ifAvailable: true, mode: 'exclusive' },
		(lock) => {
			liveOwner = lock === null;
		}
	);
	return liveOwner;
}

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion -- Recorder recovery manifests are untrusted OPFS JSON. This parser checks every field before returning the domain type. */
function isScratchKind(value: unknown): value is ScratchKind {
	return value === 'screen' || value === 'camera' || value === 'microphone';
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseRecoveryManifest(value: unknown): ScratchRecoveryManifest | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ScratchRecoveryManifest>;
	if (
		candidate.version !== RECOVERY_MANIFEST_VERSION ||
		typeof candidate.sessionId !== 'string' ||
		!/^[a-zA-Z0-9-]+$/.test(candidate.sessionId) ||
		!finiteNonNegative(candidate.createdAt) ||
		(candidate.status !== 'recording' && candidate.status !== 'complete') ||
		!Array.isArray(candidate.artifacts) ||
		candidate.artifacts.length === 0 ||
		candidate.artifacts.length > 3
	) {
		return null;
	}
	const artifacts: ScratchRecoveryArtifact[] = [];
	const scratchIds = new Set<string>();
	const kinds = new Set<ScratchKind>();
	for (const artifact of candidate.artifacts) {
		if (!artifact || typeof artifact !== 'object') return null;
		const entry = artifact as Partial<ScratchRecoveryArtifact>;
		if (
			typeof entry.scratchId !== 'string' ||
			!isScratchKind(entry.kind) ||
			!entry.scratchId.startsWith(`${entry.kind}-${candidate.sessionId}-`) ||
			!/^[a-zA-Z0-9-]+$/.test(entry.scratchId) ||
			scratchIds.has(entry.scratchId) ||
			kinds.has(entry.kind) ||
			typeof entry.mimeType !== 'string' ||
			entry.mimeType.length > 255 ||
			!finiteNonNegative(entry.startOffsetMs) ||
			!finiteNonNegative(entry.durationMs) ||
			!finiteNonNegative(entry.sizeBytes)
		) {
			return null;
		}
		scratchIds.add(entry.scratchId);
		kinds.add(entry.kind);
		artifacts.push({
			scratchId: entry.scratchId,
			kind: entry.kind,
			mimeType: entry.mimeType,
			startOffsetMs: entry.startOffsetMs,
			durationMs: entry.durationMs,
			sizeBytes: entry.sizeBytes
		});
	}
	return {
		version: RECOVERY_MANIFEST_VERSION,
		sessionId: candidate.sessionId,
		createdAt: candidate.createdAt,
		status: candidate.status,
		artifacts
	};
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

async function readRecoveryManifest(
	dir: FileSystemDirectoryHandle,
	name: string
): Promise<ScratchRecoveryManifest | null> {
	try {
		const handle = await dir.getFileHandle(name);
		const file = await handle.getFile();
		if (file.size > MAX_RECOVERY_MANIFEST_BYTES) return null;
		return parseRecoveryManifest(JSON.parse(await file.text()));
	} catch (error) {
		logger.warn('Could not read recorder recovery manifest', error);
		return null;
	}
}

export async function writeScratchRecoveryManifest(
	manifest: ScratchRecoveryManifest
): Promise<void> {
	const normalized = parseRecoveryManifest(manifest);
	if (!normalized) throw new Error('Invalid recorder recovery manifest');
	const dir = await getOpfsDir();
	if (!dir) return;
	const handle = await dir.getFileHandle(recoveryManifestName(normalized.sessionId), {
		create: true
	});
	const writable = await handle.createWritable();
	try {
		await writable.write(JSON.stringify(normalized));
		await writable.close();
	} catch (error) {
		try {
			await writable.abort();
		} catch {
			// The original write error is more useful.
		}
		throw error;
	}
}

export async function loadRecoverableScratchSessions(): Promise<RecoveredScratchSession[]> {
	const dir = await getOpfsDir();
	if (!dir) return [];
	const sessions: RecoveredScratchSession[] = [];
	for await (const [name, handle] of dir.entries()) {
		if (
			handle.kind !== 'file' ||
			!name.startsWith(RECOVERY_MANIFEST_PREFIX) ||
			!name.endsWith(RECOVERY_MANIFEST_SUFFIX)
		) {
			continue;
		}
		const manifest = await readRecoveryManifest(dir, name);
		if (!manifest) continue;
		if (
			manifest.status === 'recording' &&
			(await hasLiveScratchRecoveryOwner(manifest.sessionId))
		) {
			continue;
		}
		const artifacts: RecoveredScratchArtifact[] = [];
		for (const artifact of manifest.artifacts) {
			try {
				const artifactHandle = await dir.getFileHandle(artifact.scratchId);
				const stored = await artifactHandle.getFile();
				if (stored.size === 0) continue;
				const elapsedFallback = Math.max(
					0,
					Date.now() - manifest.createdAt - artifact.startOffsetMs
				);
				const blob = new File([stored], `${artifact.scratchId}.webm`, {
					type: artifact.mimeType || stored.type,
					lastModified: stored.lastModified
				});
				artifacts.push({
					...artifact,
					blob,
					durationMs: artifact.durationMs > 0 ? artifact.durationMs : elapsedFallback,
					sizeBytes: stored.size
				});
			} catch (error) {
				logger.warn(`Could not recover recorder scratch ${artifact.scratchId}`, error);
			}
		}
		if (artifacts.length > 0) sessions.push({ manifest, artifacts });
	}
	return sessions.sort((left, right) => left.manifest.createdAt - right.manifest.createdAt);
}

export async function discardScratchRecoverySession(
	sessionId: string,
	knownScratchIds: string[] = []
): Promise<void> {
	const dir = await getOpfsDir();
	if (!dir) return;
	const manifestName = recoveryManifestName(sessionId);
	const manifest = await readRecoveryManifest(dir, manifestName);
	const scratchIds = new Set([
		...knownScratchIds,
		...(manifest?.artifacts.map((artifact) => artifact.scratchId) ?? [])
	]);
	let retryNeeded = false;
	for (const scratchId of scratchIds) {
		try {
			await dir.removeEntry(scratchId);
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'NotFoundError')) retryNeeded = true;
		}
	}
	if (retryNeeded) return;
	try {
		await dir.removeEntry(manifestName);
	} catch {
		// Missing or already removed.
	}
}

export async function createScratchSink(
	kind: ScratchKind,
	mimeType: string,
	sessionId?: string
): Promise<ScratchSink> {
	const dir = await getOpfsDir();
	if (dir) {
		try {
			const id = `${kind}-${sessionId ? `${sessionId}-` : ''}${crypto.randomUUID()}`;
			const handle = await dir.getFileHandle(id, { create: true });
			return new OpfsSink(id, kind, mimeType, dir, handle);
		} catch (error) {
			logger.warn('OPFS sink creation failed, falling back to memory', error);
		}
	}
	// Fallback bounded memory
	const fallbackId = `${kind}-${sessionId ? `${sessionId}-` : ''}${crypto.randomUUID()}-mem`;
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
