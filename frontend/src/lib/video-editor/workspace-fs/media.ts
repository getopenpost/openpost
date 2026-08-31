/**
 * Media metadata store backed by the workspace folder.
 *
 * Each media gets `media/{id}/metadata.json`. The non-serializable
 * `FileSystemFileHandle` (present when `storageType === 'handle'`) is stashed
 * in the handles registry under kind='media', id=mediaId and re-attached on read.
 *
 * Ported from FreeCut (MIT) — workspace-fs/media.ts.
 */

import type { MediaMetadata } from '../media/types';
import { normalizeRecordingCaptureMetadata } from '../media/recording-capture-schema';
import { createLogger } from './logger';
import { deleteHandle, getHandle, saveHandle } from './handles-db';
import { requireWorkspaceRoot } from './root';
import {
	listDirectory,
	readJson,
	removeEntry,
	writeJsonAtomic,
	WorkspaceFileCorruptError
} from './fs-primitives';
import { MEDIA_DIR, mediaDir, mediaMetadataPath } from './paths';

const logger = createLogger('WorkspaceFS:Media');

type SerializedMedia = Omit<MediaMetadata, 'fileHandle'>;

async function stashFileHandle(media: MediaMetadata): Promise<SerializedMedia> {
	const { fileHandle, ...rest } = media;
	if (fileHandle) {
		await saveHandle({
			kind: 'media',
			id: media.id,
			handle: fileHandle,
			name: fileHandle.name,
			pickedAt: Date.now(),
			lastSeenSize: media.fileSize,
			lastSeenMtime: media.fileLastModified
		});
	} else {
		await deleteHandle('media', media.id).catch((error) => {
			logger.warn(`Failed to clean media handle for ${media.id}`, error);
		});
	}
	return rest;
}

function normalizeSerializedCapture(serialized: SerializedMedia): SerializedMedia {
	if (!('capture' in serialized) || serialized.capture === undefined) return serialized;
	// SAFETY: capture is verified present above, safe to read as unknown for boundary parser
	const rawCapture: unknown = (serialized as { capture: unknown }).capture;
	const normalized = normalizeRecordingCaptureMetadata(rawCapture);
	if (normalized) return { ...serialized, capture: normalized };
	// SAFETY: drop invalid capture, rest without capture satisfies SerializedMedia (capture is optional)
	const { capture: _dropped, ...rest } = serialized as SerializedMedia & { capture?: unknown };
	// SAFETY: rest is serialized without invalid capture, compatible with SerializedMedia
	return rest as SerializedMedia;
}

async function restoreFileHandle(serialized: SerializedMedia): Promise<MediaMetadata> {
	const normalized = normalizeSerializedCapture(serialized);
	const record = await getHandle('media', normalized.id);
	if (record) {
		return {
			...normalized,
			// SAFETY: media records with handles always store file handles.
			// SAFETY: the stored value satisfies the target type here.
			fileHandle: record.handle as FileSystemFileHandle
		};
	}
	// SAFETY: same registry invariant — file handle stored under kind 'media'.
	// SAFETY: the stored value satisfies MediaMetadata here.
	return normalized as MediaMetadata;
}

/**
 * Outcome of validating a stored handle against the stats captured at import:
 * ok | no-handle | permission | missing | changed (size drifted → relink flow).
 */
export type MediaHandleValidation =
	| { kind: 'ok' }
	| { kind: 'no-handle' }
	| { kind: 'permission' }
	| { kind: 'missing' }
	| { kind: 'changed'; currentSize: number; currentMtime: number };

export async function validateMediaHandle(mediaId: string): Promise<MediaHandleValidation> {
	const record = await getHandle('media', mediaId);
	if (!record) return { kind: 'no-handle' };

	// SAFETY: restored records re-attach the stashed file handle.
	// SAFETY: the stored value satisfies FileSystemFileHandle here.
	const handle = record.handle as FileSystemFileHandle;
	try {
		const file = await handle.getFile();
		const expectedSize = record.lastSeenSize;
		if (Number.isFinite(expectedSize) && file.size !== expectedSize) {
			return {
				kind: 'changed',
				currentSize: file.size,
				currentMtime: file.lastModified
			};
		}
		return { kind: 'ok' };
	} catch (error) {
		if (error instanceof DOMException && error.name === 'NotAllowedError') {
			return { kind: 'permission' };
		}
		if (error instanceof DOMException && error.name === 'NotFoundError') {
			return { kind: 'missing' };
		}
		logger.warn(`validateMediaHandle(${mediaId}) unexpected error`, error);
		return { kind: 'missing' };
	}
}

/* ──────────────────────── Parallel metadata read ────────────────────── */

const METADATA_READ_CONCURRENCY = 8;

function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			// SAFETY: getFile() rejects with NotFoundError when the file is gone.
			// SAFETY: the stored value satisfies T here.
			results[index] = await fn(items[index] as T);
		}
	}
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	return Promise.all(workers).then(() => results);
}

type MediaReadResult =
	| { kind: 'ok'; serialized: SerializedMedia }
	| { kind: 'skip' }
	| { kind: 'error'; error: unknown };

async function readAllSerializedMedia(
	root: FileSystemDirectoryHandle,
	context: string
): Promise<SerializedMedia[]> {
	const dirs = await listDirectory(root, [MEDIA_DIR]);
	const directories = dirs.filter((entry) => entry.kind === 'directory');
	const results = await mapWithConcurrency(
		directories,
		METADATA_READ_CONCURRENCY,
		async (entry): Promise<MediaReadResult> => {
			try {
				const serialized = await readJson<SerializedMedia>(root, mediaMetadataPath(entry.name));
				if (!serialized) return { kind: 'skip' };
				return { kind: 'ok', serialized };
			} catch (error) {
				if (error instanceof WorkspaceFileCorruptError) {
					logger.warn(`${context}: skipping corrupt metadata.json for ${entry.name}`, error);
					return { kind: 'skip' };
				}
				return { kind: 'error', error };
			}
		}
	);
	const serialized: SerializedMedia[] = [];
	for (const result of results) {
		if (!result) continue;
		if (result.kind === 'error') throw result.error;
		if (result.kind === 'ok') serialized.push(result.serialized);
	}
	return serialized;
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getAllMedia(): Promise<MediaMetadata[]> {
	const root = requireWorkspaceRoot();
	try {
		const serialized = await readAllSerializedMedia(root, 'getAllMedia');
		return await Promise.all(serialized.map((s) => restoreFileHandle(s)));
	} catch (error) {
		logger.error('getAllMedia failed', error);
		throw new Error('Failed to load media from workspace');
	}
}

export async function getMedia(id: string): Promise<MediaMetadata | undefined> {
	const root = requireWorkspaceRoot();
	try {
		const serialized = await readJson<SerializedMedia>(root, mediaMetadataPath(id));
		if (!serialized) return undefined;
		return restoreFileHandle(serialized);
	} catch (error) {
		logger.error(`getMedia(${id}) failed`, error);
		throw new Error(`Failed to load media: ${id}`);
	}
}

export async function createMedia(media: MediaMetadata): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	try {
		const existing = await readJson<SerializedMedia>(root, mediaMetadataPath(media.id));
		if (existing) {
			throw new Error(`Media already exists: ${media.id}`);
		}
		const serialized = await stashFileHandle(media);
		await writeJsonAtomic(root, mediaMetadataPath(media.id), serialized);
		return media;
	} catch (error) {
		logger.error('createMedia failed', error);
		throw error;
	}
}

export async function updateMedia(
	id: string,
	updates: Partial<MediaMetadata>
): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	try {
		const existingSerialized = await readJson<SerializedMedia>(root, mediaMetadataPath(id));
		if (!existingSerialized) {
			throw new Error(`Media not found: ${id}`);
		}
		const existing = await restoreFileHandle(existingSerialized);
		const updated: MediaMetadata = {
			...existing,
			...updates,
			id
		};
		const nextSerialized = await stashFileHandle(updated);
		await writeJsonAtomic(root, mediaMetadataPath(id), nextSerialized);
		return updated;
	} catch (error) {
		logger.error(`updateMedia(${id}) failed`, error);
		throw error;
	}
}

export async function deleteMedia(id: string): Promise<void> {
	const root = requireWorkspaceRoot();
	try {
		await removeEntry(root, mediaDir(id), { recursive: true });
		await deleteHandle('media', id).catch((error) => {
			logger.warn(`Failed to clean media handle for ${id}`, error);
		});
	} catch (error) {
		logger.error(`deleteMedia(${id}) failed`, error);
		throw new Error(`Failed to delete media: ${id}`);
	}
}
