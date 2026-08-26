/**
 * Crash-safe recording sessions persisted under recordings/sessions/{id}/.
 *
 * Each timeslice is written as a separate blob entry and tracked in a
 * versioned manifest (atomic tmp+rename). Listing surfaces interrupted or
 * ready takes for recovery instead of deleting them. Writes are serialized
 * and bounded via backpressure in the recorder.
 */

import { createLogger } from '../workspace-fs/logger';
import {
	listDirectory,
	readDirectoryFiles,
	readJson,
	removeEntry,
	writeBlob,
	writeJsonAtomic
} from '../workspace-fs/fs-primitives';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import {
	SESSIONS_DIR,
	sessionDir,
	sessionManifestPath,
	sessionChunkPath,
	sessionCursorPath
} from '../workspace-fs/paths';
import type { RecorderSource } from './recorder.svelte';
import type { PipGeometry } from './pip-geometry';
import type { CursorSidecar } from './cursor-capture';
import { validateCursorSidecar } from './cursor-capture';

const logger = createLogger('RecordingSessions');

export type RecordingSessionStatus = 'recording' | 'interrupted' | 'ready';

export interface RecordingChunkEntry {
	index: number;
	file: string;
	size: number;
	createdAt: number;
}

export interface RecordingSessionManifest {
	version: 1;
	id: string;
	source: RecorderSource;
	mimeType: string;
	status: RecordingSessionStatus;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	pip?: PipGeometry;
	cursor?: CursorSidecar;
	chunks: RecordingChunkEntry[];
}

// SAFETY: generic record check at storage boundary, validated field-by-field
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- generic record helper for storage boundary
function isRecord(value: unknown): value is Record<string, unknown> {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- storage boundary helper
	return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
}

function isValidUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isValidMimeForSource(mime: string, source: RecorderSource): boolean {
	if (!/^[a-z]+\/[a-z0-9\-+.]+$/i.test(mime)) return false;
	if (source === 'audio') return mime.startsWith('audio/');
	return mime.startsWith('video/') || mime.startsWith('audio/');
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- storage boundary parser
function validateManifest(value: unknown): RecordingSessionManifest | null {
	if (!isRecord(value)) return null;
	if (value.version !== 1) return null;
	if (!isString(value.id) || !isValidUuid(value.id)) return null;
	if (!isString(value.source)) return null;
	const validSources: RecorderSource[] = ['screen', 'camera', 'audio', 'screen-camera'];
	// SAFETY: source enum validated at storage boundary via includes check
	const source = value.source as RecorderSource;
	if (!validSources.includes(source)) return null;
	if (!isString(value.mimeType) || !isString(value.status)) return null;
	if (!isValidMimeForSource(value.mimeType, source)) return null;
	// SAFETY: status string validated at storage boundary
	let statusRaw = value.status as string;
	if (statusRaw === 'complete') statusRaw = 'ready';
	if (statusRaw !== 'recording' && statusRaw !== 'interrupted' && statusRaw !== 'ready')
		return null;
	const status = statusRaw as RecordingSessionStatus;
	if (!isNumber(value.createdAt) || !isNumber(value.updatedAt)) return null;
	if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return null;
	if (!Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt)) return null;
	if (value.createdAt < 0 || value.updatedAt < 0) return null;
	if (value.completedAt !== undefined) {
		// SAFETY: completedAt validated as safe integer at boundary
		const completedAt = value.completedAt as unknown;
		if (
			!isNumber(completedAt) ||
			!Number.isFinite(completedAt) ||
			!Number.isSafeInteger(completedAt)
		)
			return null;
		if ((completedAt as number) < 0) return null;
	}
	if (!Array.isArray(value.chunks)) return null;
	const seenFiles = new Set<string>();
	for (let i = 0; i < value.chunks.length; i++) {
		const entry = value.chunks[i];
		if (!isRecord(entry)) return null;
		if (!isNumber(entry.index) || !Number.isInteger(entry.index) || entry.index < 0) return null;
		if (entry.index !== i) return null;
		if (!isString(entry.file)) return null;
		const expectedFile = `chunk-${String(i).padStart(6, '0')}.webm`;
		if (entry.file !== expectedFile) return null;
		if (seenFiles.has(entry.file)) return null;
		seenFiles.add(entry.file);
		if (
			!isNumber(entry.size) ||
			!Number.isFinite(entry.size) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size < 0
		)
			return null;
		if (
			!isNumber(entry.createdAt) ||
			!Number.isFinite(entry.createdAt) ||
			!Number.isSafeInteger(entry.createdAt) ||
			entry.createdAt < 0
		)
			return null;
	}
	if (value.pip !== undefined) {
		if (!isRecord(value.pip)) return null;
		// SAFETY: pip validated at storage boundary
		const pip = value.pip as Record<string, unknown>;
		if (!isNumber(pip.x) || !Number.isFinite(pip.x) || pip.x < 0 || pip.x > 1) return null;
		if (!isNumber(pip.y) || !Number.isFinite(pip.y) || pip.y < 0 || pip.y > 1) return null;
		if (!isNumber(pip.width) || !Number.isFinite(pip.width) || pip.width < 0.1 || pip.width > 0.5)
			return null;
		if (pip.placement !== 'custom') return null;
		if ((pip.x as number) + (pip.width as number) > 1.02) return null;
	}
	if (value.cursor !== undefined) {
		const validated = validateCursorSidecar(value.cursor);
		if (!validated) return null;
	}
	// Never mutate parsed input; return copy with normalized status
	// SAFETY: manifest shape validated above, safe to cast
	const copy = { ...(value as RecordingSessionManifest) };
	// SAFETY: status validated above
	copy.status = status as RecordingSessionStatus;
	return copy;
}

function recordingLockKey(id: string): string {
	return `recording-session:${id}`;
}

export async function createRecordingSession(params: {
	source: RecorderSource;
	mimeType: string;
	pip?: PipGeometry;
	cursor?: CursorSidecar;
}): Promise<RecordingSessionManifest> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const manifest: RecordingSessionManifest = {
		version: 1,
		id,
		source: params.source,
		mimeType: params.mimeType || 'video/webm',
		status: 'recording',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		pip: params.pip,
		cursor: params.cursor,
		chunks: []
	};
	await writeJsonAtomic(root, sessionManifestPath(id), manifest);
	return manifest;
}

export async function appendRecordingChunk(
	sessionId: string,
	blob: Blob
): Promise<RecordingChunkEntry> {
	const root = requireWorkspaceRoot();
	const lockKey = recordingLockKey(sessionId);
	const { withKeyLock } = await import('../workspace-fs/with-key-lock');
	return withKeyLock(lockKey, async () => {
		const raw = await readJson<unknown>(root, sessionManifestPath(sessionId));
		const manifest = validateManifest(raw);
		if (!manifest) throw new Error(`Recording session not found: ${sessionId}`);
		const index = manifest.chunks.length;
		const fileName = `chunk-${String(index).padStart(6, '0')}.webm`;
		await writeBlob(root, sessionChunkPath(sessionId, fileName), blob);
		const entry: RecordingChunkEntry = {
			index,
			file: fileName,
			size: blob.size,
			createdAt: Date.now()
		};
		const next: RecordingSessionManifest = {
			...manifest,
			updatedAt: Date.now(),
			chunks: [...manifest.chunks, entry]
		};
		await writeJsonAtomic(root, sessionManifestPath(sessionId), next);
		return entry;
	});
}

export async function appendCursorSidecar(
	sessionId: string,
	sidecar: CursorSidecar
): Promise<void> {
	const root = requireWorkspaceRoot();
	const lockKey = recordingLockKey(sessionId);
	const { withKeyLock } = await import('../workspace-fs/with-key-lock');
	await withKeyLock(lockKey, async () => {
		const validated = validateCursorSidecar(sidecar);
		if (!validated) throw new Error('Invalid cursor sidecar');
		await writeJsonAtomic(root, sessionCursorPath(sessionId), validated);
		const raw = await readJson<unknown>(root, sessionManifestPath(sessionId));
		const manifest = validateManifest(raw);
		if (manifest) {
			await writeJsonAtomic(root, sessionManifestPath(sessionId), {
				...manifest,
				updatedAt: Date.now(),
				cursor: validated
			});
		}
	});
}

export async function listRecordingSessions(): Promise<RecordingSessionManifest[]> {
	const root = requireWorkspaceRoot();
	try {
		const entries = await listDirectory(root, SESSIONS_DIR);
		const dirs = entries.filter((e) => e.kind === 'directory');
		const manifests: RecordingSessionManifest[] = [];
		for (const dir of dirs) {
			try {
				const raw = await readJson<unknown>(root, sessionManifestPath(dir.name));
				const manifest = validateManifest(raw);
				if (manifest) manifests.push(manifest);
				else if (raw) logger.warn(`Skipping invalid manifest for ${dir.name}`);
			} catch (error) {
				logger.warn(`Skipping corrupt recording session ${dir.name}`, error);
			}
		}
		manifests.sort((a, b) => b.createdAt - a.createdAt);
		return manifests;
	} catch (error) {
		logger.warn('listRecordingSessions failed', error);
		return [];
	}
}

export async function listRecoverableSessions(): Promise<RecordingSessionManifest[]> {
	const all = await listRecordingSessions();
	return all.filter(
		(m) =>
			m.status === 'interrupted' ||
			m.status === 'ready' ||
			(m.status === 'recording' && m.chunks.length > 0)
	);
}

export async function markSessionInterrupted(sessionId: string): Promise<void> {
	const root = requireWorkspaceRoot();
	const { withKeyLock } = await import('../workspace-fs/with-key-lock');
	await withKeyLock(recordingLockKey(sessionId), async () => {
		const raw = await readJson<unknown>(root, sessionManifestPath(sessionId));
		const manifest = validateManifest(raw);
		if (!manifest) return;
		if (manifest.status === 'ready') return;
		await writeJsonAtomic(root, sessionManifestPath(sessionId), {
			...manifest,
			status: 'interrupted',
			updatedAt: Date.now()
		});
	});
}

export async function markSessionReady(
	sessionId: string
): Promise<RecordingSessionManifest | null> {
	const root = requireWorkspaceRoot();
	const { withKeyLock } = await import('../workspace-fs/with-key-lock');
	return withKeyLock(recordingLockKey(sessionId), async () => {
		const raw = await readJson<unknown>(root, sessionManifestPath(sessionId));
		const manifest = validateManifest(raw);
		if (!manifest) return null;
		const next: RecordingSessionManifest = {
			...manifest,
			status: 'ready',
			completedAt: Date.now(),
			updatedAt: Date.now()
		};
		await writeJsonAtomic(root, sessionManifestPath(sessionId), next);
		return next;
	});
}

export async function discardRecordingSession(sessionId: string): Promise<void> {
	const root = requireWorkspaceRoot();
	const { withKeyLock } = await import('../workspace-fs/with-key-lock');
	await withKeyLock(recordingLockKey(sessionId), async () => {
		await removeEntry(root, sessionDir(sessionId), { recursive: true });
	});
}

export async function readRecordingBlob(sessionId: string): Promise<Blob | null> {
	const root = requireWorkspaceRoot();
	const raw = await readJson<unknown>(root, sessionManifestPath(sessionId));
	const manifest = validateManifest(raw);
	if (!manifest || manifest.chunks.length === 0) return null;
	try {
		const files = await readDirectoryFiles(root, [...sessionDir(sessionId), 'chunks']);
		const byName = new Map(files.map((f) => [f.name, f.blob]));
		if (byName.size !== manifest.chunks.length) return null;
		const seen = new Set<string>();
		const ordered: Blob[] = [];
		for (const entry of manifest.chunks) {
			if (seen.has(entry.file)) return null;
			seen.add(entry.file);
			const blob = byName.get(entry.file);
			if (!blob) return null;
			if (blob.size !== entry.size) return null;
			ordered.push(blob);
		}
		if (ordered.length !== manifest.chunks.length) return null;
		return new Blob(ordered, { type: manifest.mimeType });
	} catch (error) {
		logger.warn(`readRecordingBlob(${sessionId}) failed`, error);
		return null;
	}
}

export async function readRecordingCursor(sessionId: string): Promise<CursorSidecar | null> {
	const root = requireWorkspaceRoot();
	const raw = await readJson<unknown>(root, sessionCursorPath(sessionId));
	return validateCursorSidecar(raw);
}
