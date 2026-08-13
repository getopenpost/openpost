import {
	VIDEO_PROJECT_LIMITS,
	cloneVideoProject,
	migrateVideoProjectDocument,
	validateVideoProject,
	type VideoProjectDocumentV1
} from '@openpost/video-project';
import { sha256 } from '@noble/hashes/sha256';
import {
	VIDEO_EDITOR_DB_NAME,
	VIDEO_EDITOR_DB_VERSION,
	VIDEO_EDITOR_ROOT,
	VIDEO_EDITOR_STORES,
	type LocalAssetIndex,
	type LocalProjectRevision,
	type LocalProjectRevisionSnapshotV1,
	type LocalVideoProject,
	type AnalysisResult,
	type ModelCacheMetadata,
	type RecordingManifest,
	type StorageBudget,
	type VideoProjectOperation,
	type VideoEditorStore
} from './types';

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

const AUTOMATIC_REVISION_LIMIT = 20;
const TRANSIENT_HEADROOM_RATIO = 0.2;
const DISPOSABLE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const ASSET_ACCESS_WRITE_INTERVAL_MS = 5 * 60 * 1_000;
const IDLE_CLEANUP_MAX_ASSETS = 24;
const IDLE_CLEANUP_MAX_BYTES = 256 * 1_024 * 1_024;
const PRESSURE_CLEANUP_MAX_ASSETS = 64;
const PRESSURE_CLEANUP_MAX_BYTES = 2 * 1_024 * 1_024 * 1_024;

export class LocalVideoProjectRevisionConflict extends Error {
	readonly expectedRevision: number;
	readonly latestRevision?: number;

	constructor(expectedRevision: number, latestRevision?: number) {
		super(
			latestRevision === undefined
				? 'This local project is no longer available.'
				: `This local project changed in another tab. Revision ${latestRevision} is now current.`
		);
		this.name = 'LocalVideoProjectRevisionConflict';
		this.expectedRevision = expectedRevision;
		this.latestRevision = latestRevision;
	}
}

export interface ApplyLocalVideoProjectRestoreOptions {
	cloudRevision?: number;
	expectedCloudProjectID?: string;
	state?: LocalVideoProject['state'];
	coverSourceID?: string;
	coverSourceCaptured?: boolean;
	cloudCoverPreviewMediaID?: string;
	cloudCoverPreviewMediaIDCaptured?: boolean;
}

export type LocalAssetIndexInput = Omit<LocalAssetIndex, 'last_accessed_at'> &
	Partial<Pick<LocalAssetIndex, 'last_accessed_at'>>;

export interface DisposableAssetCleanupOptions {
	mode?: 'idle' | 'pressure';
	now?: number;
	maxAgeMS?: number;
	maxAssets?: number;
	maxBytes?: number;
	targetBytes?: number;
	protectedProjectIDs?: Iterable<string>;
	protectedPaths?: Iterable<string>;
	signal?: AbortSignal;
}

export interface DisposableAssetCleanupResult {
	planned_count: number;
	removed_count: number;
	removed_bytes: number;
	skipped_active_count: number;
	failed_count: number;
	interrupted: boolean;
}

export interface VideoStorageRecoveryDependencies {
	estimate(requiredBytes: number): Promise<StorageBudget>;
	cleanup(options: DisposableAssetCleanupOptions): Promise<DisposableAssetCleanupResult>;
}

const activeProjectReferences = new Map<string, number>();
const activeProjectLockReleases = new Map<string, () => void>();
let scheduledCleanup:
	| {
			protectedProjectIDs: Set<string>;
	  }
	| undefined;

export async function openVideoEditorDatabase(): Promise<IDBDatabase> {
	return await new Promise((resolve, reject) => {
		const request = indexedDB.open(VIDEO_EDITOR_DB_NAME, VIDEO_EDITOR_DB_VERSION);
		request.onupgradeneeded = (event) => {
			const database = request.result;
			const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
			for (const storeName of VIDEO_EDITOR_STORES) {
				if (database.objectStoreNames.contains(storeName)) continue;
				createVideoEditorStore(database, storeName);
			}
			if (oldVersion < 2 && database.objectStoreNames.contains('projects')) {
				migrateProjectMetadataToV2(request.transaction!.objectStore('projects'));
			}
			if (oldVersion < 2 && database.objectStoreNames.contains('recording-manifests')) {
				migrateRecordingManifestsToV2(request.transaction!.objectStore('recording-manifests'));
			}
			if (oldVersion < 3 && database.objectStoreNames.contains('asset-index')) {
				migrateAssetIndexToV3(request.transaction!.objectStore('asset-index'));
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error('Local project storage could not open.'));
		request.onblocked = () =>
			reject(new Error('Close other OpenPost tabs so local project storage can be upgraded.'));
	});
}

export async function requestPersistentVideoStorage(): Promise<boolean | undefined> {
	if (!navigator.storage?.persist) return undefined;
	try {
		return await navigator.storage.persist();
	} catch {
		return undefined;
	}
}

export async function persistentVideoStorageState(): Promise<boolean | undefined> {
	if (!navigator.storage?.persisted) return undefined;
	try {
		return await navigator.storage.persisted();
	} catch {
		return undefined;
	}
}

export async function estimateStorageBudget(requiredBytes: number): Promise<StorageBudget> {
	const estimate = await navigator.storage?.estimate?.();
	return calculateStorageBudget(estimate?.usage ?? 0, estimate?.quota ?? 0, requiredBytes);
}

export async function recoverVideoStorageBudget(
	requiredBytes: number,
	options: Pick<DisposableAssetCleanupOptions, 'protectedProjectIDs' | 'signal'> = {},
	dependencies: VideoStorageRecoveryDependencies = {
		estimate: estimateStorageBudget,
		cleanup: cleanupDisposableVideoAssets
	}
): Promise<StorageBudget> {
	let budget = await dependencies.estimate(requiredBytes);
	if (budget.can_continue || budget.quota_bytes === 0 || options.signal?.aborted) return budget;
	const bytesNeeded = Math.max(1, requiredBytes + budget.headroom_bytes - budget.available_bytes);
	await dependencies.cleanup({
		mode: 'pressure',
		targetBytes: bytesNeeded,
		maxAssets: PRESSURE_CLEANUP_MAX_ASSETS,
		maxBytes: PRESSURE_CLEANUP_MAX_BYTES,
		protectedProjectIDs: options.protectedProjectIDs,
		signal: options.signal
	});
	if (options.signal?.aborted) return budget;
	budget = await dependencies.estimate(requiredBytes);
	return budget;
}

export function calculateStorageBudget(
	usageBytes: number,
	quotaBytes: number,
	requiredBytes: number
): StorageBudget {
	const safeUsage = Math.max(0, usageBytes);
	const safeQuota = Math.max(0, quotaBytes);
	const required = Math.max(0, requiredBytes);
	const headroom = Math.ceil(required * TRANSIENT_HEADROOM_RATIO);
	const available = Math.max(0, safeQuota - safeUsage);
	return {
		usage_bytes: safeUsage,
		quota_bytes: safeQuota,
		available_bytes: available,
		required_bytes: required,
		headroom_bytes: headroom,
		can_continue: safeQuota === 0 ? false : available >= required + headroom
	};
}

export async function listLocalVideoProjects(limit = 30): Promise<LocalVideoProject[]> {
	const projects = await getAll<LocalVideoProject>('projects');
	scheduleDisposableVideoCacheCleanup();
	return projects
		.sort((left, right) => right.last_opened_at.localeCompare(left.last_opened_at))
		.slice(0, limit)
		.map(cloneLocalProject);
}

export async function loadLocalVideoProject(id: string): Promise<LocalVideoProject> {
	const project = await loadAndTouchLocalVideoProject(id);
	scheduleDisposableVideoCacheCleanup({ protectedProjectIDs: [id] });
	return cloneLocalProject(project);
}

export async function saveLocalVideoProject(
	project: LocalVideoProject,
	options: {
		checkpointName?: string;
		autosaveName?: string;
		operation?: VideoProjectOperation;
	} = {}
): Promise<LocalVideoProject> {
	const validation = validateVideoProject(project.document);
	if (!validation.valid) {
		throw new Error(
			validation.issues[0]?.message ?? 'The OpenPost Video Editor project is invalid.'
		);
	}
	const bytes = new TextEncoder().encode(JSON.stringify(project.document)).byteLength;
	if (bytes > VIDEO_PROJECT_LIMITS.maxDocumentBytes) {
		throw new Error('The project document exceeds the 5 MiB local save limit.');
	}
	const now = new Date().toISOString();
	const saved: LocalVideoProject = {
		...project,
		cloud_source_map: { ...(project.cloud_source_map ?? {}) },
		unsynced_source_ids: [
			...(project.unsynced_source_ids ??
				referencedLocalSourceIDs(project.document, project.cloud_source_map ?? {}))
		],
		revision: project.revision + 1,
		updated_at: now,
		last_opened_at: now,
		document: cloneVideoProject(project.document)
	};
	const revision: LocalProjectRevision = {
		id: `${saved.id}:${saved.revision}`,
		project_id: saved.id,
		revision: saved.revision,
		kind: options.checkpointName ? 'checkpoint' : 'autosave',
		name: options.checkpointName ?? options.autosaveName,
		created_at: now,
		snapshot: localProjectRevisionSnapshot(
			saved.document,
			saved.cover_source_id,
			saved.cloud_cover_preview_media_id
		)
	};
	const journal: LocalProjectRevision | undefined = options.operation
		? {
				id: `${saved.id}:journal:${options.operation.id}`,
				project_id: saved.id,
				revision: saved.revision,
				kind: 'journal',
				created_at: options.operation.at,
				operations: [options.operation]
			}
		: undefined;
	await persistLocalVideoProjectCAS(project.revision, saved, revision, journal);
	await pruneAutomaticRevisions(saved.id);
	return cloneLocalProject(saved);
}

export async function createLocalVideoProject(
	id: string,
	document: VideoProjectDocumentV1
): Promise<LocalVideoProject> {
	const validation = validateVideoProject(document);
	if (!validation.valid) {
		throw new Error(
			validation.issues[0]?.message ?? 'The OpenPost Video Editor project is invalid.'
		);
	}
	const now = new Date().toISOString();
	const project: LocalVideoProject = {
		id,
		revision: 1,
		created_at: now,
		updated_at: now,
		last_opened_at: now,
		cloud_source_map: {},
		unsynced_source_ids: referencedLocalSourceIDs(document, {}),
		state: 'local',
		document: cloneVideoProject(document)
	};
	const firstRevision: LocalProjectRevision = {
		id: `${id}:1`,
		project_id: id,
		revision: 1,
		kind: 'autosave',
		created_at: now,
		snapshot: localProjectRevisionSnapshot(
			document,
			project.cover_source_id,
			project.cloud_cover_preview_media_id
		)
	};
	await transaction(['projects', 'project-revisions'], 'readwrite', (stores) => {
		stores.projects.add(project);
		stores['project-revisions'].add(firstRevision);
	});
	await ensureProjectDirectories(id);
	scheduleDisposableVideoCacheCleanup({ protectedProjectIDs: [id] });
	return cloneLocalProject(project);
}

export async function deleteLocalVideoProject(id: string): Promise<void> {
	const revisions = (await getAll<LocalProjectRevision>('project-revisions')).filter(
		(revision) => revision.project_id === id
	);
	const assets = (await getAll<LocalAssetIndex>('asset-index')).filter(
		(asset) => asset.project_id === id
	);
	await transaction(['projects', 'project-revisions', 'asset-index'], 'readwrite', (stores) => {
		stores.projects.delete(id);
		for (const revision of revisions) stores['project-revisions'].delete(revision.id);
		for (const asset of assets) stores['asset-index'].delete(asset.id);
	});
	const root = await videoEditorRoot(false);
	if (root) {
		try {
			await root.removeEntry('projects/' + id, { recursive: true });
		} catch {
			const projects = await directory(root, ['projects'], false);
			await projects?.removeEntry(id, { recursive: true }).catch(() => undefined);
		}
	}
}

export async function listProjectRevisions(projectID: string): Promise<LocalProjectRevision[]> {
	return (await getAll<LocalProjectRevision>('project-revisions'))
		.filter((revision) => revision.project_id === projectID && revision.kind !== 'journal')
		.map(normalizeLocalProjectRevision)
		.filter((revision): revision is LocalProjectRevision => revision !== undefined)
		.sort((left, right) => right.revision - left.revision);
}

export async function restoreLocalRevision(
	projectID: string,
	revisionID: string,
	expectedRevision: number
): Promise<LocalVideoProject> {
	const stored = await getOne<LocalProjectRevision>('project-revisions', revisionID);
	const revision = stored ? normalizeLocalProjectRevision(stored) : undefined;
	if (!revision?.document || revision.project_id !== projectID) {
		throw new Error('That local recovery point is no longer available.');
	}
	return await applyRestoredLocalVideoProjectHead(projectID, expectedRevision, revision.document, {
		coverSourceID: revision.snapshot?.cover_source_id,
		coverSourceCaptured: revision.snapshot?.snapshot_version === 1,
		cloudCoverPreviewMediaID: revision.snapshot?.cloud_cover_preview_media_id,
		cloudCoverPreviewMediaIDCaptured: Boolean(
			revision.snapshot && Object.hasOwn(revision.snapshot, 'cloud_cover_preview_media_id')
		)
	});
}

export async function applyRestoredLocalVideoProjectHead(
	projectID: string,
	expectedRevision: number,
	document: VideoProjectDocumentV1,
	options: ApplyLocalVideoProjectRestoreOptions = {}
): Promise<LocalVideoProject> {
	const validation = validateVideoProject(document);
	if (!validation.valid || !validation.document) {
		throw new Error(
			validation.issues[0]?.message ?? 'The OpenPost Video Editor recovery point is invalid.'
		);
	}
	const target = cloneVideoProject(validation.document);
	const now = new Date().toISOString();
	const database = await openVideoEditorDatabase();
	let restored: LocalVideoProject | undefined;
	let failure: Error | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(['projects', 'project-revisions'], 'readwrite');
			const projects = tx.objectStore('projects');
			const revisions = tx.objectStore('project-revisions');
			const request = projects.get(projectID);
			request.onsuccess = () => {
				const current = request.result as LocalVideoProject | undefined;
				if (
					!current ||
					current.revision !== expectedRevision ||
					(options.expectedCloudProjectID !== undefined &&
						current.cloud_project_id !== options.expectedCloudProjectID)
				) {
					failure = new LocalVideoProjectRevisionConflict(expectedRevision, current?.revision);
					tx.abort();
					return;
				}
				const restorePoint: LocalProjectRevision = {
					id: `${projectID}:restore-point:${crypto.randomUUID()}`,
					project_id: projectID,
					revision: current.revision,
					kind: 'restore_point',
					created_at: now,
					snapshot: localProjectRevisionSnapshot(
						current.document,
						current.cover_source_id,
						current.cloud_cover_preview_media_id
					)
				};
				const cloudSourceMap = Object.fromEntries(
					Object.entries(current.cloud_source_map ?? {}).filter(([sourceID]) =>
						Object.hasOwn(target.sources, sourceID)
					)
				);
				restored = {
					...current,
					revision: current.revision + 1,
					updated_at: now,
					last_opened_at: now,
					cloud_revision: options.cloudRevision ?? current.cloud_revision,
					state: options.state ?? (current.cloud_project_id ? 'local' : current.state),
					cloud_source_map: cloudSourceMap,
					unsynced_source_ids: referencedLocalSourceIDs(target, cloudSourceMap),
					cover_source_id: options.coverSourceCaptured
						? options.coverSourceID && Object.hasOwn(target.sources, options.coverSourceID)
							? options.coverSourceID
							: undefined
						: current.cover_source_id && Object.hasOwn(target.sources, current.cover_source_id)
							? current.cover_source_id
							: undefined,
					cloud_cover_preview_media_id: options.cloudCoverPreviewMediaIDCaptured
						? options.cloudCoverPreviewMediaID?.trim() || undefined
						: current.cloud_cover_preview_media_id,
					document: cloneVideoProject(target)
				};
				const newHead: LocalProjectRevision = {
					id: `${projectID}:${restored.revision}`,
					project_id: projectID,
					revision: restored.revision,
					kind: 'autosave',
					created_at: now,
					snapshot: localProjectRevisionSnapshot(
						target,
						restored.cover_source_id,
						restored.cloud_cover_preview_media_id
					)
				};
				revisions.put(restorePoint);
				revisions.put(newHead);
				projects.put(restored);
			};
			request.onerror = () => {
				failure = request.error ?? new Error('The local project could not be restored.');
				tx.abort();
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(failure ?? tx.error);
			tx.onabort = () =>
				reject(failure ?? tx.error ?? new Error('The local project restore was interrupted.'));
		});
	} finally {
		database.close();
	}
	if (!restored) throw new Error('The local project could not be restored.');
	await pruneAutomaticRevisions(projectID);
	return cloneLocalProject(restored);
}

export async function writeProjectFile(
	projectID: string,
	area: ProjectArea,
	name: string,
	data: Blob | BufferSource
): Promise<{ path: string; size: number }> {
	const safeName = safePathSegment(name);
	const projectDirectory = await projectAreaDirectory(projectID, area, true);
	if (!projectDirectory) throw new Error('Origin-private file storage is unavailable.');
	let existed = true;
	let handle: FileSystemFileHandle;
	try {
		handle = await projectDirectory.getFileHandle(safeName);
	} catch (cause) {
		if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) throw cause;
		existed = false;
		handle = await projectDirectory.getFileHandle(safeName, { create: true });
	}
	try {
		// createWritable stages the replacement and commits it atomically on close.
		// Writing through a second OPFS temporary file doubles import I/O for no
		// additional recovery guarantee.
		const writable = await handle.createWritable();
		await writable.write(data);
		await writable.close();
		const file = await handle.getFile();
		return { path: projectPath(projectID, area, safeName), size: file.size };
	} catch (cause) {
		if (!existed) await projectDirectory.removeEntry(safeName).catch(() => undefined);
		throw cause;
	}
}

export async function projectFileHandle(
	projectID: string,
	area: ProjectArea,
	name: string
): Promise<{ path: string; handle: FileSystemFileHandle }> {
	const safeName = safePathSegment(name);
	const target = await projectAreaDirectory(projectID, area, true);
	if (!target) throw new Error('Origin-private file storage is unavailable.');
	return {
		path: projectPath(projectID, area, safeName),
		handle: await target.getFileHandle(safeName, { create: true })
	};
}

export async function writeProjectStream(
	projectID: string,
	area: ProjectArea,
	name: string,
	stream: ReadableStream<Uint8Array>,
	options: {
		expectedSize?: number;
		expectedSHA256?: string;
		signal?: AbortSignal;
		onProgress?: (bytesWritten: number) => void;
	} = {}
): Promise<{ path: string; size: number; sha256: string }> {
	const safeName = safePathSegment(name);
	const target = await projectAreaDirectory(projectID, area, true);
	if (!target) throw new Error('Origin-private file storage is unavailable.');
	const temporaryName = `${safeName}.partial-${crypto.randomUUID()}`;
	const temporary = await target.getFileHandle(temporaryName, { create: true });
	const writable = await temporary.createWritable();
	const reader = stream.getReader();
	const hash = sha256.create();
	let received = 0;
	try {
		while (true) {
			options.signal?.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			if (!value.byteLength) continue;
			hash.update(value);
			await writable.write(Uint8Array.from(value));
			received += value.byteLength;
			options.onProgress?.(received);
		}
		await writable.close();
		const digest = hexDigest(hash.digest());
		if (options.expectedSize !== undefined && received !== options.expectedSize) {
			throw new Error(
				`The downloaded file is incomplete: expected ${options.expectedSize} bytes, received ${received}.`
			);
		}
		if (options.expectedSHA256 && digest.toLowerCase() !== options.expectedSHA256.toLowerCase()) {
			throw new Error('The downloaded file failed its SHA-256 integrity check.');
		}
		const movable = temporary as FileSystemFileHandle & {
			move?: (destination: FileSystemDirectoryHandle, name: string) => Promise<void>;
		};
		if (movable.move) {
			await movable.move(target, safeName);
		} else {
			const completed = await temporary.getFile();
			const finalHandle = await target.getFileHandle(safeName, { create: true });
			await completed.stream().pipeTo(await finalHandle.createWritable());
			await target.removeEntry(temporaryName);
		}
		return {
			path: projectPath(projectID, area, safeName),
			size: received,
			sha256: digest
		};
	} catch (cause) {
		await reader.cancel(cause).catch(() => undefined);
		await writable.abort(cause).catch(() => undefined);
		await target.removeEntry(temporaryName).catch(() => undefined);
		throw cause;
	} finally {
		reader.releaseLock();
	}
}

export async function openProjectWritable(
	projectID: string,
	area: ProjectArea,
	name: string,
	keepExistingData = false
): Promise<{ writable: FileSystemWritableFileStream; path: string; handle: FileSystemFileHandle }> {
	const safeName = safePathSegment(name);
	const target = await projectAreaDirectory(projectID, area, true);
	if (!target) throw new Error('Origin-private file storage is unavailable.');
	const handle = await target.getFileHandle(safeName, { create: true });
	const writable = await handle.createWritable({ keepExistingData });
	return { writable, path: projectPath(projectID, area, safeName), handle };
}

function hexDigest(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readProjectFile(path: string): Promise<File | null> {
	const segments = validateProjectPath(path);
	const root = await videoEditorRoot(false);
	if (!root) return null;
	try {
		let current = root;
		for (const segment of segments.slice(0, -1)) {
			current = await current.getDirectoryHandle(segment);
		}
		const file = await (await current.getFileHandle(segments.at(-1)!)).getFile();
		await touchProjectFileAccess(path).catch(() => undefined);
		return file;
	} catch {
		return null;
	}
}

export async function removeProjectFile(path: string): Promise<boolean> {
	const segments = validateProjectPath(path);
	const root = await videoEditorRoot(false);
	if (!root) return false;
	try {
		let current = root;
		for (const segment of segments.slice(0, -1)) {
			current = await current.getDirectoryHandle(segment);
		}
		await current.removeEntry(segments.at(-1)!);
		return true;
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'NotFoundError') return true;
		throw cause;
	}
}

export async function indexProjectAsset(asset: LocalAssetIndexInput): Promise<void> {
	await putOne('asset-index', normalizeLocalAssetIndex(asset));
}

async function touchProjectFileAccess(path: string, now = Date.now()): Promise<void> {
	await transaction(['asset-index'], 'readwrite', (stores) => {
		const request = stores['asset-index'].index('path').openCursor(IDBKeyRange.only(path));
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return;
			const asset = normalizeLocalAssetIndex(cursor.value as LocalAssetIndex);
			const refreshed = refreshLocalAssetAccess(asset, now);
			if (refreshed.last_accessed_at !== asset.last_accessed_at) cursor.update(refreshed);
			cursor.continue();
		};
	});
}

export async function listProjectAssets(
	projectID: string,
	sourceID?: string
): Promise<LocalAssetIndex[]> {
	return (await getAll<LocalAssetIndex>('asset-index'))
		.map(normalizeLocalAssetIndex)
		.filter(
			(asset) =>
				asset.project_id === projectID && (sourceID === undefined || asset.source_id === sourceID)
		)
		.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function removeDisposableProjectAssets(
	projectID: string,
	options: {
		sourceID?: string;
		kinds?: LocalAssetIndex['kind'][];
	} = {}
): Promise<{ removed_count: number; removed_bytes: number }> {
	const kinds = options.kinds ? new Set(options.kinds) : undefined;
	const assets = (await getAll<LocalAssetIndex>('asset-index'))
		.map(normalizeLocalAssetIndex)
		.filter(
			(asset) =>
				asset.project_id === projectID &&
				asset.disposable &&
				(options.sourceID === undefined || asset.source_id === options.sourceID) &&
				(!kinds || kinds.has(asset.kind))
		);
	let removedBytes = 0;
	for (const asset of assets) {
		if (!(await removeProjectFile(asset.path))) continue;
		await deleteOne('asset-index', asset.id);
		removedBytes += asset.size_bytes;
	}
	return { removed_count: assets.length, removed_bytes: removedBytes };
}

export async function saveRecordingManifest(manifest: RecordingManifest): Promise<void> {
	await putOne('recording-manifests', structuredClone(manifest));
}

export async function loadRecordingManifest(id: string): Promise<RecordingManifest | undefined> {
	const manifest = await getOne<RecordingManifest>('recording-manifests', id);
	return manifest ? normalizeRecordingManifest(manifest) : undefined;
}

export async function deleteRecordingManifest(id: string): Promise<void> {
	await deleteOne('recording-manifests', id);
}

export async function deleteRecording(manifest: RecordingManifest): Promise<void> {
	await Promise.all(manifest.tracks.map((track) => removeProjectFile(track.path)));
	await deleteRecordingManifest(manifest.id);
}

export async function listRecoverableRecordings(): Promise<RecordingManifest[]> {
	return (await getAll<RecordingManifest>('recording-manifests'))
		.map(normalizeRecordingManifest)
		.filter(
			(manifest) =>
				manifest.state === 'recording' ||
				manifest.state === 'recoverable' ||
				manifest.state === 'complete'
		)
		.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function saveAnalysisResult(result: AnalysisResult): Promise<void> {
	await putOne('analysis-results', structuredClone(result));
}

export async function listAnalysisResults(
	projectID: string,
	kind?: AnalysisResult['kind']
): Promise<AnalysisResult[]> {
	return (await getAll<AnalysisResult>('analysis-results'))
		.filter((result) => result.project_id === projectID && (!kind || result.kind === kind))
		.sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function saveModelCacheMetadata(metadata: ModelCacheMetadata): Promise<void> {
	await putOne('model-cache-metadata', structuredClone(metadata));
}

export async function listModelCacheMetadata(): Promise<ModelCacheMetadata[]> {
	return (await getAll<ModelCacheMetadata>('model-cache-metadata')).sort((left, right) =>
		left.kind.localeCompare(right.kind)
	);
}

export async function removeModelCacheMetadata(id: string): Promise<void> {
	await deleteOne('model-cache-metadata', id);
}

export function normalizeLocalAssetIndex(asset: LocalAssetIndexInput): LocalAssetIndex {
	return {
		...asset,
		last_accessed_at: asset.last_accessed_at ?? asset.updated_at ?? asset.created_at
	};
}

export function refreshLocalAssetAccess(
	asset: LocalAssetIndexInput,
	now = Date.now(),
	minimumWriteIntervalMS = ASSET_ACCESS_WRITE_INTERVAL_MS
): LocalAssetIndex {
	const normalized = normalizeLocalAssetIndex(asset);
	const previous = Date.parse(normalized.last_accessed_at);
	if (Number.isFinite(previous) && now - previous < Math.max(0, minimumWriteIntervalMS)) {
		return normalized;
	}
	return { ...normalized, last_accessed_at: new Date(now).toISOString() };
}

export function planDisposableAssetCleanup(
	assets: Iterable<LocalAssetIndexInput>,
	options: DisposableAssetCleanupOptions = {}
): LocalAssetIndex[] {
	const mode = options.mode ?? 'idle';
	const now = options.now ?? Date.now();
	const maxAgeMS = Math.max(0, options.maxAgeMS ?? DISPOSABLE_CACHE_MAX_AGE_MS);
	const maxAssets = Math.max(0, Math.floor(options.maxAssets ?? IDLE_CLEANUP_MAX_ASSETS));
	const maxBytes = Math.max(0, options.maxBytes ?? IDLE_CLEANUP_MAX_BYTES);
	const targetBytes = Math.max(0, options.targetBytes ?? Number.POSITIVE_INFINITY);
	const protectedProjects = new Set(options.protectedProjectIDs ?? []);
	const protectedPaths = new Set(options.protectedPaths ?? []);
	const candidates = [...assets]
		.map(normalizeLocalAssetIndex)
		.filter((asset) => {
			if (!asset.disposable) return false;
			if (protectedProjects.has(asset.project_id) || protectedPaths.has(asset.path)) return false;
			if (mode === 'pressure') return true;
			const accessedAt = Date.parse(asset.last_accessed_at);
			return !Number.isFinite(accessedAt) || now - accessedAt >= maxAgeMS;
		})
		.sort((left, right) => {
			const accessOrder = left.last_accessed_at.localeCompare(right.last_accessed_at);
			if (accessOrder !== 0) return accessOrder;
			const creationOrder = left.created_at.localeCompare(right.created_at);
			return creationOrder !== 0 ? creationOrder : left.id.localeCompare(right.id);
		});

	const planned: LocalAssetIndex[] = [];
	let plannedBytes = 0;
	for (const asset of candidates) {
		if (planned.length >= maxAssets || plannedBytes >= targetBytes) break;
		if (asset.size_bytes > maxBytes - plannedBytes) continue;
		planned.push(asset);
		plannedBytes += asset.size_bytes;
	}
	return planned;
}

export async function executeDisposableAssetCleanup(
	assets: readonly LocalAssetIndex[],
	remove: (asset: LocalAssetIndex) => Promise<boolean>,
	signal?: AbortSignal
): Promise<DisposableAssetCleanupResult> {
	const result: DisposableAssetCleanupResult = {
		planned_count: assets.length,
		removed_count: 0,
		removed_bytes: 0,
		skipped_active_count: 0,
		failed_count: 0,
		interrupted: false
	};
	for (const asset of assets) {
		if (signal?.aborted) {
			result.interrupted = true;
			break;
		}
		try {
			if (!(await remove(asset))) {
				result.skipped_active_count += 1;
				continue;
			}
			result.removed_count += 1;
			result.removed_bytes += asset.size_bytes;
		} catch {
			result.failed_count += 1;
		}
	}
	return result;
}

export async function cleanupDisposableVideoAssets(
	options: DisposableAssetCleanupOptions = {}
): Promise<DisposableAssetCleanupResult> {
	const [assets, projects] = await Promise.all([
		getAll<LocalAssetIndex>('asset-index'),
		getAll<LocalVideoProject>('projects')
	]);
	const protectedProjectIDs = new Set(options.protectedProjectIDs ?? []);
	for (const projectID of activeProjectReferences.keys()) protectedProjectIDs.add(projectID);
	const protectedPaths = new Set(options.protectedPaths ?? []);
	for (const project of projects) {
		for (const source of Object.values(project.document.sources)) {
			if (source.locator.type === 'local-opfs') protectedPaths.add(source.locator.path);
		}
	}
	const planned = planDisposableAssetCleanup(assets, {
		...options,
		protectedProjectIDs,
		protectedPaths
	});
	return await executeDisposableAssetCleanup(
		planned,
		async (asset) =>
			await withVideoProjectCleanupLock(asset.project_id, async () => {
				if (!(await removeProjectFile(asset.path))) {
					throw new Error('Origin-private file storage is temporarily unavailable.');
				}
				await deleteOne('asset-index', asset.id);
			}),
		options.signal
	);
}

export async function cleanStaleDisposableAssets(now = Date.now()): Promise<number> {
	return (await cleanupDisposableVideoAssets({ mode: 'idle', now })).removed_count;
}

export function registerActiveVideoProject(projectID: string): () => void {
	const id = projectID.trim();
	if (!id) return () => undefined;
	const references = activeProjectReferences.get(id) ?? 0;
	activeProjectReferences.set(id, references + 1);
	if (references === 0) holdSharedVideoProjectLock(id);
	scheduleDisposableVideoCacheCleanup({ protectedProjectIDs: [id] });
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (activeProjectReferences.get(id) ?? 1) - 1;
		if (remaining > 0) {
			activeProjectReferences.set(id, remaining);
			return;
		}
		activeProjectReferences.delete(id);
		activeProjectLockReleases.get(id)?.();
		activeProjectLockReleases.delete(id);
	};
}

export function scheduleDisposableVideoCacheCleanup(
	options: Pick<DisposableAssetCleanupOptions, 'protectedProjectIDs'> = {}
): void {
	if (typeof window === 'undefined') return;
	if (scheduledCleanup) {
		for (const projectID of options.protectedProjectIDs ?? []) {
			scheduledCleanup.protectedProjectIDs.add(projectID);
		}
		return;
	}
	const state = {
		protectedProjectIDs: new Set(options.protectedProjectIDs ?? [])
	};
	scheduledCleanup = state;
	const run = () => {
		if (scheduledCleanup !== state) return;
		scheduledCleanup = undefined;
		void cleanupDisposableVideoAssets({
			mode: 'idle',
			maxAssets: IDLE_CLEANUP_MAX_ASSETS,
			maxBytes: IDLE_CLEANUP_MAX_BYTES,
			protectedProjectIDs: state.protectedProjectIDs
		}).catch(() => undefined);
	};
	const idleWindow = window as Window & {
		requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
	};
	if (typeof idleWindow.requestIdleCallback === 'function') {
		idleWindow.requestIdleCallback(run, { timeout: 5_000 });
	} else {
		globalThis.setTimeout(run, 1_000);
	}
}

export type ProjectArea =
	| 'sources'
	| 'recordings'
	| 'proxies'
	| 'thumbnails'
	| 'waveforms'
	| 'analysis'
	| 'exports'
	| 'temp';

export function projectPath(projectID: string, area: ProjectArea, name: string): string {
	return `projects/${safePathSegment(projectID)}/${area}/${safePathSegment(name)}`;
}

export function validateProjectPath(path: string): string[] {
	const segments = path.split('/').filter(Boolean);
	if (
		segments.length < 4 ||
		segments[0] !== 'projects' ||
		segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))
	) {
		throw new Error('Invalid OpenPost Video Editor project path.');
	}
	return segments;
}

async function ensureProjectDirectories(projectID: string): Promise<void> {
	for (const area of [
		'sources',
		'recordings',
		'proxies',
		'thumbnails',
		'waveforms',
		'analysis',
		'exports',
		'temp'
	] satisfies ProjectArea[]) {
		await projectAreaDirectory(projectID, area, true);
	}
}

async function projectAreaDirectory(
	projectID: string,
	area: ProjectArea,
	create: boolean
): Promise<FileSystemDirectoryHandle | null> {
	const root = await videoEditorRoot(create);
	if (!root) return null;
	return await directory(root, ['projects', safePathSegment(projectID), area], create);
}

async function videoEditorRoot(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	const storage = navigator.storage as StorageManagerWithDirectory | undefined;
	if (!storage?.getDirectory) return null;
	try {
		const root = await storage.getDirectory();
		return await root.getDirectoryHandle(VIDEO_EDITOR_ROOT, { create });
	} catch {
		return null;
	}
}

async function directory(
	root: FileSystemDirectoryHandle,
	segments: string[],
	create: boolean
): Promise<FileSystemDirectoryHandle | null> {
	try {
		let current = root;
		for (const segment of segments) current = await current.getDirectoryHandle(segment, { create });
		return current;
	} catch {
		return null;
	}
}

function safePathSegment(value: string): string {
	const segment = value
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!segment || segment === '.' || segment === '..') throw new Error('Invalid local file name.');
	return segment.slice(0, 180);
}

function createVideoEditorStore(database: IDBDatabase, storeName: VideoEditorStore): void {
	const store = database.createObjectStore(storeName, { keyPath: 'id' });
	switch (storeName) {
		case 'projects':
			store.createIndex('last_opened_at', 'last_opened_at');
			break;
		case 'project-revisions':
			store.createIndex('project_id', 'project_id');
			store.createIndex('project_revision', ['project_id', 'revision']);
			break;
		case 'asset-index':
			store.createIndex('project_id', 'project_id');
			store.createIndex('path', 'path');
			store.createIndex('last_accessed_at', 'last_accessed_at');
			break;
		case 'recording-manifests':
		case 'analysis-results':
		case 'export-jobs':
			store.createIndex('project_id', 'project_id');
			break;
		case 'model-cache-metadata':
			break;
	}
}

function migrateAssetIndexToV3(store: IDBObjectStore): void {
	if (!store.indexNames.contains('path')) store.createIndex('path', 'path');
	if (!store.indexNames.contains('last_accessed_at')) {
		store.createIndex('last_accessed_at', 'last_accessed_at');
	}
	const request = store.openCursor();
	request.onsuccess = () => {
		const cursor = request.result;
		if (!cursor) return;
		const asset = cursor.value as Partial<LocalAssetIndex>;
		asset.last_accessed_at ??= asset.updated_at ?? asset.created_at ?? new Date(0).toISOString();
		cursor.update(asset);
		cursor.continue();
	};
}

function migrateProjectMetadataToV2(store: IDBObjectStore): void {
	const request = store.openCursor();
	request.onsuccess = () => {
		const cursor = request.result;
		if (!cursor) return;
		const project = cursor.value as Partial<LocalVideoProject> & {
			document?: VideoProjectDocumentV1;
		};
		project.cloud_source_map ??= {};
		project.unsynced_source_ids ??= project.document
			? referencedLocalSourceIDs(project.document, project.cloud_source_map)
			: [];
		cursor.update(project);
		cursor.continue();
	};
}

function migrateRecordingManifestsToV2(store: IDBObjectStore): void {
	const request = store.openCursor();
	request.onsuccess = () => {
		const cursor = request.result;
		if (!cursor) return;
		cursor.update(normalizeRecordingManifest(cursor.value as RecordingManifest));
		cursor.continue();
	};
}

function holdSharedVideoProjectLock(projectID: string): void {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	activeProjectLockReleases.set(projectID, release);
	const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
	if (!locks) return;
	void locks
		.request(videoProjectLockName(projectID), { mode: 'shared' }, async () => await held)
		.catch(() => undefined);
}

async function withVideoProjectCleanupLock(
	projectID: string,
	work: () => Promise<void>
): Promise<boolean> {
	if (activeProjectReferences.has(projectID)) return false;
	const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
	if (!locks) {
		if (activeProjectReferences.has(projectID)) return false;
		await work();
		return true;
	}
	let completed = false;
	await locks.request(
		videoProjectLockName(projectID),
		{ mode: 'exclusive', ifAvailable: true },
		async (lock) => {
			if (!lock || activeProjectReferences.has(projectID)) return;
			await work();
			completed = true;
		}
	);
	return completed;
}

function videoProjectLockName(projectID: string): string {
	return `openpost-video-editor:active-project:${projectID}`;
}

export function normalizeRecordingManifest(manifest: RecordingManifest): RecordingManifest {
	const migrated = structuredClone(manifest) as RecordingManifest;
	migrated.manifest_version = 2;
	migrated.session_epoch_ms ??= migrated.session_started_at;
	migrated.flush_sequence ??= 0;
	migrated.finalization_state ??=
		migrated.state === 'complete'
			? 'complete'
			: migrated.state === 'failed'
				? 'failed'
				: migrated.state === 'recoverable'
					? 'recoverable'
					: 'open';
	migrated.events ??= [];
	for (const track of migrated.tracks ?? []) {
		track.session_start_offset_us ??= Math.max(
			0,
			track.start_offset_us -
				Math.max(0, migrated.session_started_at - migrated.session_epoch_ms) * 1_000
		);
		track.verified_byte_length ??= track.bytes_written ?? 0;
		track.segments ??= [
			{
				id: `${track.id}:segment:0`,
				path: track.path,
				mime_type: track.mime_type,
				session_start_us: track.session_start_offset_us,
				session_end_us: track.session_start_offset_us + Math.max(0, track.duration_us),
				media_start_us: 0,
				media_end_us: Math.max(0, track.duration_us),
				reason_started: 'recovery',
				reason_ended: track.state === 'complete' ? 'session-stop' : 'device-loss'
			}
		];
		for (const chunk of track.chunks ?? []) {
			chunk.media_start_us ??= Math.max(0, chunk.timestamp_us - 1_000_000);
			chunk.media_end_us ??= Math.max(chunk.media_start_us, chunk.timestamp_us);
			chunk.session_start_us ??= track.session_start_offset_us + chunk.media_start_us;
			chunk.session_end_us ??= track.session_start_offset_us + chunk.media_end_us;
			chunk.flush_sequence ??= migrated.flush_sequence;
		}
	}
	return migrated;
}

function referencedLocalSourceIDs(
	document: VideoProjectDocumentV1,
	cloudSourceMap: Record<string, string>
): string[] {
	const referenced = new Set<string>();
	for (const item of document.primary_sequence) {
		if ('source_id' in item) referenced.add(item.source_id);
	}
	for (const track of document.visual_tracks) {
		for (const item of track.items) {
			if ('source_id' in item) referenced.add(item.source_id);
		}
	}
	for (const track of document.audio_tracks) {
		for (const item of track.items) referenced.add(item.source_id);
	}
	return [...referenced]
		.filter((sourceID) => {
			const source = document.sources[sourceID];
			return source?.locator.type === 'local-opfs' && !cloudSourceMap[sourceID];
		})
		.sort();
}

function localProjectRevisionSnapshot(
	document: VideoProjectDocumentV1,
	coverSourceID?: string,
	cloudCoverPreviewMediaID?: string,
	cloudCoverCaptured = true
): LocalProjectRevisionSnapshotV1 {
	return {
		snapshot_version: 1,
		document: cloneVideoProject(document),
		...(coverSourceID ? { cover_source_id: coverSourceID } : {}),
		...(cloudCoverCaptured
			? { cloud_cover_preview_media_id: cloudCoverPreviewMediaID?.trim() ?? '' }
			: {})
	};
}

function normalizeLocalProjectRevision(
	revision: LocalProjectRevision
): LocalProjectRevision | undefined {
	const snapshot = revision.snapshot;
	if (snapshot && Number(snapshot.snapshot_version) !== 1) return undefined;
	const document = snapshot?.document ?? revision.document;
	if (!document) return undefined;
	const validation = validateVideoProject(document);
	if (!validation.valid || !validation.document) return undefined;
	return {
		...revision,
		document: cloneVideoProject(validation.document),
		...(snapshot
			? {
					snapshot: localProjectRevisionSnapshot(
						validation.document,
						snapshot.cover_source_id,
						snapshot.cloud_cover_preview_media_id,
						Object.hasOwn(snapshot, 'cloud_cover_preview_media_id')
					)
				}
			: {})
	};
}

async function pruneAutomaticRevisions(projectID: string): Promise<void> {
	const automatic = (await getAll<LocalProjectRevision>('project-revisions'))
		.filter((revision) => revision.project_id === projectID && revision.kind === 'autosave')
		.sort((left, right) => right.revision - left.revision);
	await Promise.all(
		automatic
			.slice(AUTOMATIC_REVISION_LIMIT)
			.map((revision) => deleteOne('project-revisions', revision.id))
	);
}

async function loadAndTouchLocalVideoProject(id: string): Promise<LocalVideoProject> {
	const database = await openVideoEditorDatabase();
	let loaded: LocalVideoProject | undefined;
	let failure: Error | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(['projects', 'project-revisions'], 'readwrite');
			const projects = tx.objectStore('projects');
			const revisions = tx.objectStore('project-revisions');
			const request = projects.get(id);
			request.onsuccess = () => {
				const stored = request.result as LocalVideoProject | undefined;
				if (!stored) {
					failure = new Error(
						'This local OpenPost Video Editor project is missing or was removed.'
					);
					tx.abort();
					return;
				}
				const project = cloneLocalProject(stored);
				const migration = migrateVideoProjectDocument(project.document);
				project.cloud_source_map ??= {};
				project.unsynced_source_ids ??= referencedLocalSourceIDs(
					migration.document,
					project.cloud_source_map
				);
				const now = new Date().toISOString();
				if (migration.migrated) {
					const backup: LocalProjectRevision = {
						id: `${project.id}:migration-backup:${now}`,
						project_id: project.id,
						revision: project.revision,
						kind: 'migration-backup',
						name: `Before local schema ${migration.sourceVersion} normalization`,
						created_at: now,
						raw_document: structuredClone(project.document)
					};
					project.document = migration.document;
					project.updated_at = now;
					revisions.put(backup);
				}
				project.last_opened_at = now;
				projects.put(project);
				loaded = project;
			};
			request.onerror = () => {
				failure = request.error ?? new Error('The local project could not be opened.');
				tx.abort();
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(failure ?? tx.error);
			tx.onabort = () =>
				reject(failure ?? tx.error ?? new Error('The local project open was interrupted.'));
		});
	} finally {
		database.close();
	}
	if (!loaded) throw new Error('The local project could not be opened.');
	return loaded;
}

async function persistLocalVideoProjectCAS(
	expectedRevision: number,
	project: LocalVideoProject,
	revision: LocalProjectRevision,
	journal?: LocalProjectRevision
): Promise<void> {
	const database = await openVideoEditorDatabase();
	let failure: Error | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(['projects', 'project-revisions'], 'readwrite');
			const projects = tx.objectStore('projects');
			const revisions = tx.objectStore('project-revisions');
			const request = projects.get(project.id);
			request.onsuccess = () => {
				const current = request.result as LocalVideoProject | undefined;
				if (!current || current.revision !== expectedRevision) {
					failure = new LocalVideoProjectRevisionConflict(expectedRevision, current?.revision);
					tx.abort();
					return;
				}
				projects.put(project);
				revisions.put(revision);
				if (journal) revisions.put(journal);
			};
			request.onerror = () => {
				failure = request.error ?? new Error('The local project could not be saved.');
				tx.abort();
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(failure ?? tx.error);
			tx.onabort = () =>
				reject(failure ?? tx.error ?? new Error('The local project save was interrupted.'));
		});
	} finally {
		database.close();
	}
}

async function getAll<T>(storeName: VideoEditorStore): Promise<T[]> {
	const database = await openVideoEditorDatabase();
	try {
		return await new Promise<T[]>((resolve, reject) => {
			const request = database.transaction(storeName).objectStore(storeName).getAll();
			request.onsuccess = () => resolve((request.result as T[]) ?? []);
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

async function getOne<T>(storeName: VideoEditorStore, key: IDBValidKey): Promise<T | undefined> {
	const database = await openVideoEditorDatabase();
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const request = database.transaction(storeName).objectStore(storeName).get(key);
			request.onsuccess = () => resolve(request.result as T | undefined);
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

async function putOne(storeName: VideoEditorStore, value: unknown): Promise<void> {
	await transaction([storeName], 'readwrite', (stores) => stores[storeName].put(value));
}

async function deleteOne(storeName: VideoEditorStore, key: IDBValidKey): Promise<void> {
	await transaction([storeName], 'readwrite', (stores) => stores[storeName].delete(key));
}

async function transaction(
	storeNames: VideoEditorStore[],
	mode: IDBTransactionMode,
	work: (stores: Record<VideoEditorStore, IDBObjectStore>) => void
): Promise<void> {
	const database = await openVideoEditorDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(storeNames, mode);
			const stores = {} as Record<VideoEditorStore, IDBObjectStore>;
			for (const name of storeNames) stores[name] = tx.objectStore(name);
			work(stores);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error ?? new Error('Local project save was interrupted.'));
		});
	} finally {
		database.close();
	}
}

function cloneLocalProject(project: LocalVideoProject): LocalVideoProject {
	return {
		...project,
		cloud_source_map: { ...(project.cloud_source_map ?? {}) },
		unsynced_source_ids: [...(project.unsynced_source_ids ?? [])],
		document: cloneVideoProject(project.document)
	};
}
