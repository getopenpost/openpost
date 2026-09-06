/**
 * Tiny dedicated IndexedDB for FileSystemHandle storage.
 *
 * FileSystem*Handle objects can't serialize to disk files and must live
 * somewhere browser-native to survive reloads. Single store: `handles`,
 * keyed by a compound id `{kind}:{id}`.
 *
 * Schema is v1 forever. Any future evolution creates a parallel DB, not
 * a version bump on this one.
 *
 * Ported from FreeCut (MIT) — handles-db.ts, on raw IndexedDB instead of `idb`.
 */

import { createLogger } from './logger';

const logger = createLogger('HandlesDB');

const HANDLES_DB_NAME = 'openpost-video-handles-db';
const HANDLES_DB_VERSION = 1;
const HANDLES_STORE = 'handles';

export type HandleKind = 'workspace' | 'media' | 'project-folder';

export interface HandleRecord {
	/** Compound id: `${kind}:${id}`. */
	key: string;
	kind: HandleKind;
	id: string;
	handle: FileSystemDirectoryHandle | FileSystemFileHandle;
	name: string;
	pickedAt: number;
	/** For media handles only — drives the "missing file" re-link UX. */
	lastSeenPath?: string;
	lastSeenSize?: number;
	lastSeenMtime?: number;
	/**
	 * For the sentinel `workspace:current` record only — the stable id of the
	 * known-workspace entry that is currently active.
	 */
	activeWorkspaceId?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getHandlesDB(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(HANDLES_DB_NAME, HANDLES_DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(HANDLES_STORE)) {
					const store = db.createObjectStore(HANDLES_STORE, { keyPath: 'key' });
					store.createIndex('kind', 'kind', { unique: false });
				}
			};
			request.onblocked = () => {
				logger.warn('Handles DB upgrade blocked — close other tabs.');
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}
	return dbPromise;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function compoundKey(kind: HandleKind, id: string): string {
	return `${kind}:${id}`;
}

export async function getHandle(kind: HandleKind, id: string): Promise<HandleRecord | null> {
	try {
		const db = await getHandlesDB();
		const record = await requestAsPromise(
			db
				.transaction(HANDLES_STORE, 'readonly')
				.objectStore(HANDLES_STORE)
				.get(compoundKey(kind, id))
		);
		// SAFETY: the store only persists HandleRecord values.
		// SAFETY: the stored value satisfies HandleRecord | undefined here.
		return (record as HandleRecord | undefined) ?? null;
	} catch (error) {
		logger.error(`getHandle(${kind}, ${id}) failed`, error);
		return null;
	}
}

export async function saveHandle(record: Omit<HandleRecord, 'key'>): Promise<void> {
	const db = await getHandlesDB();
	const full: HandleRecord = {
		...record,
		key: compoundKey(record.kind, record.id)
	};
	await requestAsPromise(
		db.transaction(HANDLES_STORE, 'readwrite').objectStore(HANDLES_STORE).put(full)
	);
}

export async function deleteHandle(kind: HandleKind, id: string): Promise<void> {
	const db = await getHandlesDB();
	await requestAsPromise(
		db
			.transaction(HANDLES_STORE, 'readwrite')
			.objectStore(HANDLES_STORE)
			.delete(compoundKey(kind, id))
	);
}

async function listHandlesByKind(kind: HandleKind): Promise<HandleRecord[]> {
	const db = await getHandlesDB();
	const index = db.transaction(HANDLES_STORE, 'readonly').objectStore(HANDLES_STORE).index('kind');
	// SAFETY: the kind index only contains HandleRecord entries.
	return requestAsPromise(index.getAll(kind)) as Promise<HandleRecord[]>;
}

/* ───────────────────────────── Workspace shortcut ─────────────────────── */

const WORKSPACE_ID = 'current';

export async function getWorkspaceHandleRecord(): Promise<HandleRecord | null> {
	return getHandle('workspace', WORKSPACE_ID);
}

/**
 * List the known workspaces (everything except the `current` sentinel),
 * most-recently-used first.
 */
export async function listKnownWorkspaces(): Promise<HandleRecord[]> {
	const all = await listHandlesByKind('workspace');
	return all.filter((r) => r.id !== WORKSPACE_ID).sort((a, b) => b.pickedAt - a.pickedAt);
}

async function nextWorkspacePickedAt(): Promise<number> {
	const records = await listHandlesByKind('workspace');
	const latest = records.reduce((value, record) => Math.max(value, record.pickedAt), 0);
	return Math.max(Date.now(), latest + 1);
}

async function findKnownWorkspaceByHandle(
	handle: FileSystemDirectoryHandle
): Promise<HandleRecord | null> {
	const known = await listKnownWorkspaces();
	for (const record of known) {
		try {
			// SAFETY: known-workspace records always store directory handles.
			const candidate = record.handle as FileSystemDirectoryHandle;
			if (await candidate.isSameEntry(handle)) return record;
		} catch {
			// Stale handle — ignore.
		}
	}
	return null;
}

/**
 * Save (or reuse) a known-workspace record for the picked folder, then
 * point `workspace:current` at it. Picking a folder already in the list
 * just refreshes its `pickedAt` and activates it.
 */
export async function saveWorkspaceHandleRecord(handle: FileSystemDirectoryHandle): Promise<void> {
	const existing = await findKnownWorkspaceByHandle(handle);
	const workspaceId = existing?.id ?? crypto.randomUUID();
	const pickedAt = await nextWorkspacePickedAt();

	await saveHandle({
		kind: 'workspace',
		id: workspaceId,
		handle,
		name: handle.name,
		pickedAt
	});

	await saveHandle({
		kind: 'workspace',
		id: WORKSPACE_ID,
		handle,
		name: handle.name,
		pickedAt,
		activeWorkspaceId: workspaceId
	});
}

/**
 * Activate an already-known workspace. Caller is responsible for
 * verifying permission on the returned handle before using it.
 */
export async function activateWorkspaceHandle(workspaceId: string): Promise<HandleRecord | null> {
	const record = await getHandle('workspace', workspaceId);
	if (!record) return null;
	const pickedAt = await nextWorkspacePickedAt();

	await saveHandle({
		kind: 'workspace',
		id: record.id,
		handle: record.handle,
		name: record.name,
		pickedAt
	});

	await saveHandle({
		kind: 'workspace',
		id: WORKSPACE_ID,
		handle: record.handle,
		name: record.name,
		pickedAt,
		activeWorkspaceId: workspaceId
	});
	return { ...record, pickedAt };
}

/**
 * Delete a known-workspace record. If it's the active one, also clear
 * the `current` pointer so the gate reverts to pick-folder state.
 */
export async function removeKnownWorkspace(workspaceId: string): Promise<void> {
	await deleteHandle('workspace', workspaceId);
	const current = await getWorkspaceHandleRecord();
	if (current?.activeWorkspaceId === workspaceId) {
		await deleteHandle('workspace', WORKSPACE_ID);
	}
}

/**
 * One-shot migration for users whose `workspace:current` was written by
 * an older version that didn't track known workspaces. No-op once migrated.
 */
export async function ensureKnownWorkspaceForCurrent(): Promise<void> {
	const current = await getWorkspaceHandleRecord();
	if (!current || current.activeWorkspaceId) return;

	const workspaceId = crypto.randomUUID();
	await saveHandle({
		kind: 'workspace',
		id: workspaceId,
		handle: current.handle,
		name: current.name,
		pickedAt: current.pickedAt
	});
	await saveHandle({ ...current, activeWorkspaceId: workspaceId });
}

/* ───────────────────────────── Permission helpers ─────────────────────── */

export type HandlePermissionState = 'granted' | 'prompt' | 'denied';

export async function queryHandlePermission(
	handle: FileSystemHandle,
	mode: 'read' | 'readwrite' = 'readwrite'
): Promise<HandlePermissionState> {
	try {
		// SAFETY: queryPermission resolves a PermissionState string.
		// SAFETY: callers pass directory handles for workspace roots.
		const state = await (handle as FileSystemDirectoryHandle).queryPermission?.({ mode });
		// SAFETY: the stored value satisfies HandlePermissionState here.
		return (state as HandlePermissionState) ?? 'denied';
	} catch (error) {
		logger.warn('queryPermission failed', error);
		return 'denied';
	}
}

export async function requestHandlePermission(
	handle: FileSystemHandle,
	mode: 'read' | 'readwrite' = 'readwrite'
): Promise<HandlePermissionState> {
	try {
		// SAFETY: requestPermission resolves a PermissionState string.
		// SAFETY: callers pass directory handles for workspace roots.
		const state = await (handle as FileSystemDirectoryHandle).requestPermission?.({ mode });
		// SAFETY: the stored value satisfies HandlePermissionState here.
		return (state as HandlePermissionState) ?? 'denied';
	} catch (error) {
		logger.warn('requestPermission failed', error);
		return 'denied';
	}
}

export function isFileSystemAccessSupported(): boolean {
	return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function __resetHandlesDBForTesting(): Promise<void> {
	if (dbPromise) {
		const db = await dbPromise.catch(() => null);
		db?.close();
		dbPromise = null;
	}
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(HANDLES_DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error('Handles DB reset was blocked.'));
	});
}
