import {
	VIDEO_PROJECT_LIMITS,
	cloneVideoProject,
	validateVideoProject,
	type VideoProjectDocumentV1
} from '@openpost/video-project';
import {
	VIDEO_STUDIO_DB_NAME,
	VIDEO_STUDIO_DB_VERSION,
	VIDEO_STUDIO_ROOT,
	VIDEO_STUDIO_STORES,
	type LocalAssetIndex,
	type LocalProjectRevision,
	type LocalVideoProject,
	type AnalysisResult,
	type ModelCacheMetadata,
	type RecordingManifest,
	type StorageBudget,
	type VideoProjectOperation,
	type VideoStudioStore
} from './types';

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

const AUTOMATIC_REVISION_LIMIT = 20;
const TRANSIENT_HEADROOM_RATIO = 0.2;
const STALE_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export async function openVideoStudioDatabase(): Promise<IDBDatabase> {
	return await new Promise((resolve, reject) => {
		const request = indexedDB.open(VIDEO_STUDIO_DB_NAME, VIDEO_STUDIO_DB_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			for (const storeName of VIDEO_STUDIO_STORES) {
				if (database.objectStoreNames.contains(storeName)) continue;
				createVideoStudioStore(database, storeName);
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
	return projects
		.sort((left, right) => right.last_opened_at.localeCompare(left.last_opened_at))
		.slice(0, limit)
		.map(cloneLocalProject);
}

export async function loadLocalVideoProject(id: string): Promise<LocalVideoProject> {
	const project = await getOne<LocalVideoProject>('projects', id);
	if (!project) throw new Error('This local Video Studio project is missing or was removed.');
	const validation = validateVideoProject(project.document);
	if (!validation.valid) {
		throw new Error(validation.issues[0]?.message ?? 'This local project cannot be opened.');
	}
	project.last_opened_at = new Date().toISOString();
	await putOne('projects', project);
	return cloneLocalProject(project);
}

export async function saveLocalVideoProject(
	project: LocalVideoProject,
	options: { checkpointName?: string; operation?: VideoProjectOperation } = {}
): Promise<LocalVideoProject> {
	const validation = validateVideoProject(project.document);
	if (!validation.valid) {
		throw new Error(validation.issues[0]?.message ?? 'The Video Studio project is invalid.');
	}
	const bytes = new TextEncoder().encode(JSON.stringify(project.document)).byteLength;
	if (bytes > VIDEO_PROJECT_LIMITS.maxDocumentBytes) {
		throw new Error('The project document exceeds the 5 MiB local save limit.');
	}
	const now = new Date().toISOString();
	const saved: LocalVideoProject = {
		...project,
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
		name: options.checkpointName,
		created_at: now,
		document: cloneVideoProject(saved.document)
	};
	await transaction(['projects', 'project-revisions'], 'readwrite', (stores) => {
		stores.projects.put(saved);
		stores['project-revisions'].put(revision);
		if (options.operation) {
			const journal: LocalProjectRevision = {
				id: `${saved.id}:journal:${options.operation.id}`,
				project_id: saved.id,
				revision: saved.revision,
				kind: 'journal',
				created_at: options.operation.at,
				operations: [options.operation]
			};
			stores['project-revisions'].put(journal);
		}
	});
	await pruneAutomaticRevisions(saved.id);
	return cloneLocalProject(saved);
}

export async function createLocalVideoProject(
	id: string,
	document: VideoProjectDocumentV1
): Promise<LocalVideoProject> {
	const validation = validateVideoProject(document);
	if (!validation.valid) {
		throw new Error(validation.issues[0]?.message ?? 'The Video Studio project is invalid.');
	}
	const now = new Date().toISOString();
	const project: LocalVideoProject = {
		id,
		revision: 1,
		created_at: now,
		updated_at: now,
		last_opened_at: now,
		state: 'local',
		document: cloneVideoProject(document)
	};
	const firstRevision: LocalProjectRevision = {
		id: `${id}:1`,
		project_id: id,
		revision: 1,
		kind: 'autosave',
		created_at: now,
		document: cloneVideoProject(document)
	};
	await transaction(['projects', 'project-revisions'], 'readwrite', (stores) => {
		stores.projects.add(project);
		stores['project-revisions'].add(firstRevision);
	});
	await ensureProjectDirectories(id);
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
	const root = await videoStudioRoot(false);
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
		.sort((left, right) => right.revision - left.revision);
}

export async function restoreLocalRevision(
	projectID: string,
	revisionID: string
): Promise<LocalVideoProject> {
	const revision = await getOne<LocalProjectRevision>('project-revisions', revisionID);
	if (!revision?.document || revision.project_id !== projectID) {
		throw new Error('That local recovery point is no longer available.');
	}
	const project = await loadLocalVideoProject(projectID);
	project.document = cloneVideoProject(revision.document);
	return await saveLocalVideoProject(project, {
		checkpointName: `Restored revision ${revision.revision}`
	});
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
	const temporaryName = `${safeName}.partial-${crypto.randomUUID()}`;
	const temporary = await projectDirectory.getFileHandle(temporaryName, { create: true });
	try {
		const writable = await temporary.createWritable();
		await writable.write(data);
		await writable.close();
		const file = await temporary.getFile();
		const finalHandle = await projectDirectory.getFileHandle(safeName, { create: true });
		const finalWritable = await finalHandle.createWritable();
		await file.stream().pipeTo(finalWritable);
		await projectDirectory.removeEntry(temporaryName);
		return { path: projectPath(projectID, area, safeName), size: file.size };
	} catch (cause) {
		await projectDirectory.removeEntry(temporaryName).catch(() => undefined);
		throw cause;
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

export async function readProjectFile(path: string): Promise<File | null> {
	const segments = validateProjectPath(path);
	const root = await videoStudioRoot(false);
	if (!root) return null;
	try {
		let current = root;
		for (const segment of segments.slice(0, -1)) {
			current = await current.getDirectoryHandle(segment);
		}
		return await (await current.getFileHandle(segments.at(-1)!)).getFile();
	} catch {
		return null;
	}
}

export async function removeProjectFile(path: string): Promise<void> {
	const segments = validateProjectPath(path);
	const root = await videoStudioRoot(false);
	if (!root) return;
	try {
		let current = root;
		for (const segment of segments.slice(0, -1)) {
			current = await current.getDirectoryHandle(segment);
		}
		await current.removeEntry(segments.at(-1)!);
	} catch (cause) {
		if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) throw cause;
	}
}

export async function indexProjectAsset(asset: LocalAssetIndex): Promise<void> {
	await putOne('asset-index', asset);
}

export async function listProjectAssets(
	projectID: string,
	sourceID?: string
): Promise<LocalAssetIndex[]> {
	return (await getAll<LocalAssetIndex>('asset-index'))
		.filter(
			(asset) =>
				asset.project_id === projectID && (sourceID === undefined || asset.source_id === sourceID)
		)
		.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function saveRecordingManifest(manifest: RecordingManifest): Promise<void> {
	await putOne('recording-manifests', structuredClone(manifest));
}

export async function loadRecordingManifest(id: string): Promise<RecordingManifest | undefined> {
	return await getOne<RecordingManifest>('recording-manifests', id);
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

export async function cleanStaleDisposableAssets(now = Date.now()): Promise<number> {
	const assets = await getAll<LocalAssetIndex>('asset-index');
	let removed = 0;
	for (const asset of assets) {
		if (!asset.disposable || now - Date.parse(asset.updated_at) < STALE_CACHE_AGE_MS) continue;
		const segments = validateProjectPath(asset.path);
		const root = await videoStudioRoot(false);
		if (root) {
			try {
				let current = root;
				for (const segment of segments.slice(0, -1)) {
					current = await current.getDirectoryHandle(segment);
				}
				await current.removeEntry(segments.at(-1)!);
			} catch {
				// A cleared or interrupted cache is already removed.
			}
		}
		await deleteOne('asset-index', asset.id);
		removed += 1;
	}
	return removed;
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
		throw new Error('Invalid Video Studio project path.');
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
	const root = await videoStudioRoot(create);
	if (!root) return null;
	return await directory(root, ['projects', safePathSegment(projectID), area], create);
}

async function videoStudioRoot(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	const storage = navigator.storage as StorageManagerWithDirectory | undefined;
	if (!storage?.getDirectory) return null;
	try {
		const root = await storage.getDirectory();
		return await root.getDirectoryHandle(VIDEO_STUDIO_ROOT, { create });
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

function createVideoStudioStore(database: IDBDatabase, storeName: VideoStudioStore): void {
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
		case 'recording-manifests':
		case 'analysis-results':
		case 'export-jobs':
			store.createIndex('project_id', 'project_id');
			break;
		case 'model-cache-metadata':
			break;
	}
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

async function getAll<T>(storeName: VideoStudioStore): Promise<T[]> {
	const database = await openVideoStudioDatabase();
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

async function getOne<T>(storeName: VideoStudioStore, key: IDBValidKey): Promise<T | undefined> {
	const database = await openVideoStudioDatabase();
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

async function putOne(storeName: VideoStudioStore, value: unknown): Promise<void> {
	await transaction([storeName], 'readwrite', (stores) => stores[storeName].put(value));
}

async function deleteOne(storeName: VideoStudioStore, key: IDBValidKey): Promise<void> {
	await transaction([storeName], 'readwrite', (stores) => stores[storeName].delete(key));
}

async function transaction(
	storeNames: VideoStudioStore[],
	mode: IDBTransactionMode,
	work: (stores: Record<VideoStudioStore, IDBObjectStore>) => void
): Promise<void> {
	const database = await openVideoStudioDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(storeNames, mode);
			const stores = {} as Record<VideoStudioStore, IDBObjectStore>;
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
	return { ...project, document: cloneVideoProject(project.document) };
}
