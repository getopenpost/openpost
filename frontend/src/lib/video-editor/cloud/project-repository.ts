import {
	portableVideoProjectDocument,
	videoProjectMutationOperations,
	VideoProjectMutationOutbox,
	type MutationOutboxStorage,
	type PendingVideoProjectMutation,
	type VideoProjectMutationOperation
} from '@openpost/video-project';
import { browser } from '$app/environment';
import { client } from '$lib/api/client';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import {
	cacheCloudProjectDocument,
	offlineMediaURL,
	purgeCloudVideoProjectOfflineData,
	readOfflineCloudProject
} from './offline-project-cache';

const OUTBOX_DATABASE = 'openpost-video-project-sync';
const OUTBOX_STORE = 'state';
const OUTBOX_KEY = 'mutation-outbox-v1';
const DEVICE_KEY = 'openpost:video-project-device-id:v1';

export function purgeCloudVideoProjectDeviceData(): void {
	if (!browser) return;
	localStorage.removeItem(DEVICE_KEY);
	indexedDB.deleteDatabase(OUTBOX_DATABASE);
	purgeCloudVideoProjectOfflineData();
}

export interface CloudVideoProject<TDocument extends object> {
	id: string;
	workspaceId: string;
	name: string;
	headRevision: number;
	document: TDocument;
	syncStatus: 'pending' | 'uploading' | 'saving' | 'synced' | 'needs_attention';
	attentionReason: string;
	trashedAt: string;
	updatedAt: string;
}

export interface CloudVideoProjectRevision<TDocument extends object> {
	revision: number;
	parentRevision: number;
	kind: string;
	document: TDocument;
	createdAt: string;
	expiresAt: string;
	checkpointNames: string[];
	checkpoints: Array<{ id: string; name: string }>;
}

export interface CloudVideoProjectConflict<TDocument extends object> {
	id: string;
	name: string;
	document: TDocument;
	overlapTargets: string[];
	createdAt: string;
}

export class CloudVideoProjectConflictError<TDocument extends object> extends Error {
	constructor(
		readonly conflictId: string,
		readonly localDocument: TDocument
	) {
		super('This Cloud Video Project changed elsewhere');
		this.name = 'CloudVideoProjectConflictError';
	}
}

class BrowserMutationStorage implements MutationOutboxStorage {
	async load(): Promise<PendingVideoProjectMutation[]> {
		if (!browser) return [];
		const database = await openOutboxDatabase();
		return new Promise((resolve, reject) => {
			const request = database.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).get(OUTBOX_KEY);
			request.onsuccess = () =>
				resolve((request.result as PendingVideoProjectMutation[] | undefined) ?? []);
			request.onerror = () =>
				reject(request.error ?? new Error('Could not read the Video Project outbox'));
		});
	}

	async save(entries: PendingVideoProjectMutation[]): Promise<void> {
		if (!browser) return;
		const database = await openOutboxDatabase();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(OUTBOX_STORE, 'readwrite');
			transaction.objectStore(OUTBOX_STORE).put(entries, OUTBOX_KEY);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error('Could not save the Video Project outbox'));
		});
	}
}

function openOutboxDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(OUTBOX_DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(OUTBOX_STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error('Could not open Video Project sync storage'));
	});
}

function deviceId(): string {
	if (!browser) return 'web';
	const current = localStorage.getItem(DEVICE_KEY);
	if (current) return current;
	const created = crypto.randomUUID();
	localStorage.setItem(DEVICE_KEY, created);
	return created;
}

function cloudProject<TDocument extends object>(raw: {
	id: string;
	workspace_id: string;
	name: string;
	head_revision: number;
	document: Record<string, unknown>;
	sync_status: CloudVideoProject<TDocument>['syncStatus'];
	attention_reason?: string;
	trashed_at?: string;
	updated_at: string;
}): CloudVideoProject<TDocument> {
	return {
		id: raw.id,
		workspaceId: raw.workspace_id,
		name: raw.name,
		headRevision: raw.head_revision,
		document: raw.document as TDocument,
		syncStatus: raw.sync_status,
		attentionReason: raw.attention_reason ?? '',
		trashedAt: raw.trashed_at ?? '',
		updatedAt: raw.updated_at
	};
}

export class CloudVideoProjectRepository<TDocument extends object> {
	readonly outbox = new VideoProjectMutationOutbox(new BrowserMutationStorage());

	constructor(readonly workspaceId: string) {}

	async list(includeTrash = false): Promise<CloudVideoProject<TDocument>[]> {
		const { data, error } = await client.GET('/video-projects', {
			params: {
				query: { workspace_id: this.workspaceId, include_trash: includeTrash }
			}
		});
		if (error || !data) throw new Error('Could not load Cloud Video Projects');
		return data.map((project) => cloudProject<TDocument>(project));
	}

	async get(id: string): Promise<CloudVideoProject<TDocument>> {
		const { data, error } = await client.GET('/video-projects/{id}', {
			params: { path: { id }, query: { workspace_id: this.workspaceId } }
		});
		if (error || !data) {
			const offline = await readOfflineCloudProject<TDocument>(this.workspaceId, id);
			if (offline) return offline.project;
			throw new Error('Could not load Cloud Video Project');
		}
		const project = cloudProject<TDocument>(data);
		await cacheCloudProjectDocument(project).catch(() => undefined);
		return project;
	}

	async create(name: string, document: TDocument): Promise<CloudVideoProject<TDocument>> {
		return this.createWithId(crypto.randomUUID(), name, document);
	}

	async createWithId(
		id: string,
		name: string,
		document: TDocument
	): Promise<CloudVideoProject<TDocument>> {
		const portable = portableVideoProjectDocument({ ...document, id });
		const { data, error } = await client.POST('/video-projects', {
			body: {
				id,
				workspace_id: this.workspaceId,
				name,
				device_id: deviceId(),
				document: portable
			}
		});
		if (error || !data) throw new Error('Could not create Cloud Video Project');
		return cloudProject<TDocument>(data);
	}

	async save(project: CloudVideoProject<TDocument>, document: TDocument): Promise<void> {
		const portable = portableVideoProjectDocument(document);
		const operations = videoProjectMutationOperations(
			project.document as Record<string, unknown>,
			portable as Record<string, unknown>
		) satisfies VideoProjectMutationOperation[];
		if (operations.length === 0) return;
		await this.outbox.enqueue({
			projectId: project.id,
			batch: {
				workspace_id: this.workspaceId,
				mutation_id: crypto.randomUUID(),
				base_revision: project.headRevision,
				device_id: deviceId(),
				operations
			},
			queuedAt: Date.now(),
			attempts: 0
		});
		const results = await this.flush();
		const latest = results.at(-1);
		if (latest?.outcome === 'conflict') {
			throw new CloudVideoProjectConflictError(latest.conflictId, portable);
		}
		if (latest) project.headRevision = latest.revision;
		project.document = portable;
	}

	async listRevisions(id: string): Promise<CloudVideoProjectRevision<TDocument>[]> {
		const { data, error } = await client.GET('/video-projects/{id}/revisions', {
			params: { path: { id }, query: { workspace_id: this.workspaceId } }
		});
		if (error || !data) throw new Error('Could not load Cloud Video Project history');
		return data.map((revision) => ({
			revision: revision.revision,
			parentRevision: revision.parent_revision,
			kind: revision.kind,
			document: revision.document as TDocument,
			createdAt: revision.created_at,
			expiresAt: revision.expires_at ?? '',
			checkpointNames: revision.checkpoint_names ?? [],
			checkpoints: (revision.checkpoints ?? []).map((checkpoint) => ({
				id: checkpoint.id,
				name: checkpoint.name
			}))
		}));
	}

	async listConflicts(id: string): Promise<CloudVideoProjectConflict<TDocument>[]> {
		const { data, error } = await client.GET('/video-projects/{id}/conflicts', {
			params: { path: { id }, query: { workspace_id: this.workspaceId } }
		});
		if (error || !data) throw new Error('Could not load Cloud Video Project conflicts');
		return data.map((conflict) => ({
			id: conflict.id,
			name: conflict.name,
			document: conflict.document as TDocument,
			overlapTargets: conflict.overlap_targets,
			createdAt: conflict.created_at
		}));
	}

	async createCheckpoint(id: string, name: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/checkpoints', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId, name }
		});
		if (error) throw new Error('Could not create Cloud Video Project checkpoint');
	}

	async deleteCheckpoint(id: string, checkpointId: string): Promise<void> {
		const { error } = await client.DELETE('/video-projects/{id}/checkpoints/{checkpoint_id}', {
			params: {
				path: { id, checkpoint_id: checkpointId },
				query: { workspace_id: this.workspaceId }
			}
		});
		if (error) throw new Error('Could not delete Cloud Video Project checkpoint');
	}

	async restoreRevision(id: string, revision: number): Promise<CloudVideoProject<TDocument>> {
		const { data, error } = await client.POST('/video-projects/{id}/restore-revision', {
			params: { path: { id } },
			body: {
				workspace_id: this.workspaceId,
				revision,
				device_id: deviceId()
			}
		});
		if (error || !data) throw new Error('Could not restore Cloud Video Project revision');
		return cloudProject<TDocument>(data);
	}

	async resolveConflict(
		id: string,
		conflictId: string,
		resolution: 'keep_current' | 'use_conflict'
	): Promise<CloudVideoProject<TDocument>> {
		const { data, error } = await client.POST(
			'/video-projects/{id}/conflicts/{conflict_id}/resolve',
			{
				params: { path: { id, conflict_id: conflictId } },
				body: {
					workspace_id: this.workspaceId,
					resolution,
					device_id: deviceId()
				}
			}
		);
		if (error || !data) throw new Error('Could not resolve Cloud Video Project conflict');
		return cloudProject<TDocument>(data);
	}

	async listMedia(id: string): Promise<MediaMetadata[]> {
		const { data: assetData, error: assetError } = await client.GET('/video-projects/{id}/assets', {
			params: { path: { id }, query: { workspace_id: this.workspaceId } }
		});
		if (assetError || !assetData) {
			const offline = await readOfflineCloudProject<TDocument>(this.workspaceId, id);
			if (offline) return offline.media;
			throw new Error('Could not load Cloud Video Project assets');
		}
		const readyByMediaId = new Map(
			assetData
				.filter((asset) => asset.status === 'ready' && asset.media_id)
				.map((asset) => [asset.media_id, asset] as const)
		);
		if (readyByMediaId.size === 0) return [];

		const media: MediaMetadata[] = [];
		for (let offset = 0; ; offset += 200) {
			const { data, error } = await client.GET('/media', {
				params: {
					query: {
						workspace_id: this.workspaceId,
						asset_kind: 'project_asset',
						lifecycle: 'all',
						limit: 200,
						offset
					}
				}
			});
			if (error || !data) {
				const offline = await readOfflineCloudProject<TDocument>(this.workspaceId, id);
				if (offline) return offline.media;
				throw new Error('Could not load Cloud Video Project media');
			}
			for (const item of data.media ?? []) {
				const asset = readyByMediaId.get(item.id);
				if (!asset) continue;
				const mediaKind = item.mime_type.startsWith('audio/')
					? 'audio'
					: item.mime_type.startsWith('image/')
						? 'image'
						: 'video';
				media.push({
					id: asset.stable_media_id,
					storageType: 'cloud',
					remoteUrl: item.url,
					offlineUrl: offlineMediaURL(this.workspaceId, id, asset.stable_media_id),
					fileName: item.original_filename,
					fileSize: item.size,
					mimeType: item.mime_type,
					duration: item.duration_ms / 1000,
					width: item.width,
					height: item.height,
					fps: item.frame_rate,
					codec: item.video_codec ?? item.container_format ?? '',
					bitrate: item.bit_rate,
					audioCodec: item.audio_codec,
					tags: [mediaKind]
				});
			}
			if ((data.media?.length ?? 0) < 200) break;
		}
		return media;
	}

	async reserveAsset(
		id: string,
		input: {
			stableMediaId: string;
			fileName: string;
			mimeType: string;
			size: number;
			sha256: string;
		}
	): Promise<string> {
		const { data, error } = await client.POST('/video-projects/{id}/assets', {
			params: { path: { id } },
			body: {
				workspace_id: this.workspaceId,
				stable_media_id: input.stableMediaId,
				original_filename: input.fileName,
				mime_type: input.mimeType,
				size: input.size,
				sha256: input.sha256,
				preparation: {},
				device_id: deviceId()
			}
		});
		if (error || !data) throw new Error('Could not reserve Cloud Video Project asset');
		return data.id;
	}

	async flush() {
		return this.outbox.drain(async (entry) => {
			const { data, error } = await client.POST('/video-projects/{id}/mutations', {
				params: { path: { id: entry.projectId } },
				body: entry.batch
			});
			if (error || !data) throw new Error('Cloud Video Project save is waiting for a connection');
			return data.outcome === 'conflict'
				? {
						outcome: 'conflict' as const,
						revision: data.revision,
						conflictId: data.conflict_id ?? ''
					}
				: { outcome: 'applied' as const, revision: data.revision };
		});
	}

	async trash(id: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/trash', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId }
		});
		if (error) throw new Error('Could not move Cloud Video Project to Trash');
	}

	async restore(id: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/restore', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId }
		});
		if (error) throw new Error('Could not restore Cloud Video Project');
	}
}
