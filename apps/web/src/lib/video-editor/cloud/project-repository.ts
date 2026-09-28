import { isAudioCodecSupported } from '../media/audio-codec-support';
import { isProResCodec } from '../media/prores-decoder';
import { editorAssetMetadataSchema, type EditorAssetMetadata } from './asset-metadata';
import {
	portableVideoProjectDocument,
	videoProjectMutationOperations,
	VideoProjectMutationOutbox,
	type MutationOutboxStorage,
	type PendingVideoProjectMutation,
	type VideoProjectMutationOperation
} from '@openpost/video-project';
import type { components } from '@openpost/api-contract';
import {
	mediaMetadataQueryOptions,
	mediaQueryKeys,
	videoProjectAssetsQueryOptions,
	videoProjectConflictsQueryOptions,
	videoProjectDetailQueryOptions,
	videoProjectListQueryOptions,
	videoProjectQueryKeys,
	videoProjectRevisionsQueryOptions
} from '@openpost/query-catalog';
import { z } from 'zod';
import { browser } from '$app/environment';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { mediaQueryAPI } from '$lib/query/media';
import { videoProjectQueryAPI } from '$lib/query/video-projects';
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

const pendingVideoProjectMutationSchema = z.object({
	projectId: z.string(),
	batch: z.object({
		workspace_id: z.string(),
		mutation_id: z.string(),
		base_revision: z.number(),
		device_id: z.string().optional(),
		operations: z.array(
			z.object({
				kind: z.enum(['set', 'delete']),
				target: z.string(),
				path: z.string().startsWith('/'),
				value: z.unknown().optional()
			})
		)
	}),
	queuedAt: z.number(),
	attempts: z.number()
});
const cloudDocumentSchema = z.looseObject({});
const cloudDocumentFamilySchema = z.looseObject({
	schemaFamily: z.string().optional()
});
type CloudVideoProjectDocument = components['schemas']['VideoProjectResponse']['document'];

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

export function cloudVideoProjectFamily(project: CloudVideoProject<object>): string {
	const result = cloudDocumentFamilySchema.safeParse(project.document);
	return result.success ? (result.data.schemaFamily ?? '') : '';
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
			request.onsuccess = () => {
				const stored = request.result;
				resolve(Array.isArray(stored) ? stored.filter(isPendingMutation) : []);
			};
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

function isPendingMutation(value: unknown): value is PendingVideoProjectMutation {
	return pendingVideoProjectMutationSchema.safeParse(value).success;
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
	document: CloudVideoProjectDocument;
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
		document: documentFromAPI<TDocument>(raw.document),
		syncStatus: raw.sync_status,
		attentionReason: raw.attention_reason ?? '',
		trashedAt: raw.trashed_at ?? '',
		updatedAt: raw.updated_at
	};
}

function documentFromAPI<TDocument extends object>(value: CloudVideoProjectDocument): TDocument {
	const result = cloudDocumentSchema.safeParse(value);
	if (!result.success) throw new Error('Cloud Video Project document must be an object');
	// SAFETY: Zod proved this is a JSON object. The editor validates its versioned document when loading it.
	return result.data as TDocument;
}

export class CloudVideoProjectRepository<TDocument extends object> {
	readonly outbox = new VideoProjectMutationOutbox(new BrowserMutationStorage());

	constructor(readonly workspaceId: string) {}

	private invalidateLists(): Promise<void> {
		return queryClient.invalidateQueries({
			queryKey: videoProjectQueryKeys.lists(this.workspaceId),
			refetchType: 'none'
		});
	}

	private async invalidateProjectState(id: string): Promise<void> {
		await Promise.all([
			this.invalidateLists(),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.detail(this.workspaceId, id),
				refetchType: 'none'
			}),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.revisions(this.workspaceId, id),
				refetchType: 'none'
			}),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.conflicts(this.workspaceId, id),
				refetchType: 'none'
			})
		]);
	}

	async list(includeTrash = false): Promise<CloudVideoProject<TDocument>[]> {
		const data = await queryClient.query(
			videoProjectListQueryOptions(videoProjectQueryAPI, this.workspaceId, includeTrash)
		);
		return data.map((project) => cloudProject<TDocument>(project));
	}

	async get(id: string): Promise<CloudVideoProject<TDocument>> {
		let data;
		try {
			data = await queryClient.query(
				videoProjectDetailQueryOptions(videoProjectQueryAPI, this.workspaceId, id)
			);
		} catch {
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
		queryClient.setQueryData(videoProjectQueryKeys.detail(this.workspaceId, data.id), data);
		await this.invalidateLists();
		return cloudProject<TDocument>(data);
	}

	async save(project: CloudVideoProject<TDocument>, document: TDocument): Promise<void> {
		const portable = portableVideoProjectDocument(document);
		const operations = videoProjectMutationOperations(
			project.document,
			portable
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
		const data = await queryClient.query(
			videoProjectRevisionsQueryOptions(videoProjectQueryAPI, this.workspaceId, id)
		);
		return data.map((revision) => ({
			revision: revision.revision,
			parentRevision: revision.parent_revision,
			kind: revision.kind,
			document: documentFromAPI<TDocument>(revision.document),
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
		const data = await queryClient.query(
			videoProjectConflictsQueryOptions(videoProjectQueryAPI, this.workspaceId, id)
		);
		return data.map((conflict) => ({
			id: conflict.id,
			name: conflict.name,
			document: documentFromAPI<TDocument>(conflict.document),
			overlapTargets: conflict.overlap_targets ?? [],
			createdAt: conflict.created_at
		}));
	}

	async createCheckpoint(id: string, name: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/checkpoints', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId, name }
		});
		if (error) throw new Error('Could not create Cloud Video Project checkpoint');
		await queryClient.invalidateQueries({
			queryKey: videoProjectQueryKeys.revisions(this.workspaceId, id),
			refetchType: 'none'
		});
	}

	async deleteCheckpoint(id: string, checkpointId: string): Promise<void> {
		const { error } = await client.DELETE('/video-projects/{id}/checkpoints/{checkpoint_id}', {
			params: {
				path: { id, checkpoint_id: checkpointId },
				query: { workspace_id: this.workspaceId }
			}
		});
		if (error) throw new Error('Could not delete Cloud Video Project checkpoint');
		await queryClient.invalidateQueries({
			queryKey: videoProjectQueryKeys.revisions(this.workspaceId, id),
			refetchType: 'none'
		});
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
		queryClient.setQueryData(videoProjectQueryKeys.detail(this.workspaceId, id), data);
		await Promise.all([
			this.invalidateLists(),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.revisions(this.workspaceId, id),
				refetchType: 'none'
			}),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.conflicts(this.workspaceId, id),
				refetchType: 'none'
			})
		]);
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
		queryClient.setQueryData(videoProjectQueryKeys.detail(this.workspaceId, id), data);
		await Promise.all([
			this.invalidateLists(),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.revisions(this.workspaceId, id),
				refetchType: 'none'
			}),
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.conflicts(this.workspaceId, id),
				refetchType: 'none'
			})
		]);
		return cloudProject<TDocument>(data);
	}

	async listMedia(id: string): Promise<MediaMetadata[]> {
		let assetData;
		try {
			assetData = await this.listAssets(id);
		} catch {
			const offline = await readOfflineCloudProject<TDocument>(this.workspaceId, id);
			if (offline) return offline.media;
			throw new Error('Could not load Cloud Video Project assets');
		}
		const readyAssets = assetData.filter(
			(asset): asset is typeof asset & { media_id: string } =>
				asset.status === 'ready' && Boolean(asset.media_id)
		);
		const mediaIds = [...new Set(readyAssets.map((asset) => asset.media_id))];
		if (mediaIds.length === 0) return [];

		const media: MediaMetadata[] = [];
		for (let offset = 0; offset < mediaIds.length; offset += 200) {
			let data;
			try {
				data = await queryClient.query(
					mediaMetadataQueryOptions(
						mediaQueryAPI,
						this.workspaceId,
						mediaIds.slice(offset, offset + 200)
					)
				);
			} catch {
				const offline = await readOfflineCloudProject<TDocument>(this.workspaceId, id);
				if (offline) return offline.media;
				throw new Error('Could not load Cloud Video Project media');
			}
			const metadataById = new Map((data.media ?? []).map((item) => [item.id, item]));
			for (const asset of readyAssets) {
				const item = metadataById.get(asset.media_id);
				if (!item) continue;
				const prepared = editorAssetMetadataSchema.safeParse(asset.preparation.editorMedia);
				const probe = prepared.success ? prepared.data : undefined;
				const mimeType = item.mime_type || asset.mime_type;
				const fileSize = item.size ?? asset.size;
				const duration =
					(item.duration_ms ?? 0) > 0 ? (item.duration_ms ?? 0) / 1000 : (probe?.duration ?? 0);
				const mediaKind =
					probe?.codec === 'lottie' &&
					(mimeType === 'application/zip' || mimeType === 'application/json')
						? 'lottie'
						: mimeType.startsWith('font/')
							? 'font'
							: mimeType.startsWith('audio/')
								? 'audio'
								: mimeType.startsWith('image/')
									? 'image'
									: 'video';
				media.push({
					id: asset.stable_media_id,
					storageType: 'cloud',
					remoteUrl: item.url,
					remoteThumbnailUrl: item.thumbnail_url || item.poster_thumbnail_url || undefined,
					offlineUrl: offlineMediaURL(this.workspaceId, id, asset.stable_media_id),
					contentHash: asset.sha256 || undefined,
					fileName: asset.original_filename,
					fileSize,
					mimeType,
					duration,
					width: item.width || probe?.width || 0,
					height: item.height || probe?.height || 0,
					fps: item.frame_rate || probe?.fps || 0,
					codec:
						mediaKind === 'lottie'
							? 'lottie'
							: item.video_codec || probe?.codec || item.container_format || '',
					bitrate: Math.round((fileSize * 8) / Math.max(1, duration)),
					audioCodec: item.audio_codec || probe?.audioCodec,
					hasAudio: probe?.hasAudio,
					audioCodecSupported: isAudioCodecSupported(item.audio_codec || probe?.audioCodec),
					videoCodecSupported: isProResCodec(item.video_codec || probe?.codec) ? false : undefined,
					lottieTotalFrames: probe?.lottieTotalFrames,
					lottieMarkers: probe?.lottieMarkers,
					animationFrameCount: probe?.animationFrameCount,
					attribution: probe?.attribution,
					tags: [
						...new Set([
							mediaKind,
							...(probe?.tags.filter(
								(tag) => !['audio', 'video', 'image', 'font', 'lottie'].includes(tag)
							) ?? [])
						])
					]
				});
			}
		}
		return media;
	}

	async listAssets(id: string): Promise<components['schemas']['ProjectAssetResponse'][]> {
		return queryClient.query(
			videoProjectAssetsQueryOptions(videoProjectQueryAPI, this.workspaceId, id)
		);
	}

	async deleteAssetForMedia(id: string, stableMediaId: string): Promise<void> {
		const asset = (await this.listAssets(id)).find(
			(candidate) => candidate.stable_media_id === stableMediaId
		);
		if (!asset) return;

		const { error } = await client.DELETE('/video-projects/{id}/assets/{asset_id}', {
			params: {
				path: { id, asset_id: asset.id },
				query: { workspace_id: this.workspaceId }
			}
		});
		if (error) throw new Error('Could not delete Cloud Video Project asset');
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.assets(this.workspaceId, id),
				refetchType: 'none'
			}),
			queryClient.invalidateQueries({
				queryKey: mediaQueryKeys.lists(this.workspaceId),
				refetchType: 'none'
			})
		]);
	}

	async reserveAsset(
		id: string,
		input: {
			stableMediaId: string;
			fileName: string;
			mimeType: string;
			size: number;
			sha256: string;
			mediaMetadata?: EditorAssetMetadata;
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
				preparation: input.mediaMetadata
					? { editorMedia: editorAssetMetadataSchema.parse({ version: 1, ...input.mediaMetadata }) }
					: {},
				device_id: deviceId()
			}
		});
		if (error || !data) throw new Error('Could not reserve Cloud Video Project asset');
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: videoProjectQueryKeys.assets(this.workspaceId, id),
				refetchType: 'none'
			}),
			queryClient.invalidateQueries({
				queryKey: mediaQueryKeys.lists(this.workspaceId),
				refetchType: 'none'
			})
		]);
		return data.id;
	}

	async flush() {
		return this.outbox.drain(async (entry) => {
			const { data, error } = await client.POST('/video-projects/{id}/mutations', {
				params: { path: { id: entry.projectId } },
				body: entry.batch
			});
			if (error || !data) throw new Error('Cloud Video Project save is waiting for a connection');
			await this.invalidateProjectState(entry.projectId);
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
		await this.invalidateProjectState(id);
	}

	async restore(id: string): Promise<void> {
		const { error } = await client.POST('/video-projects/{id}/restore', {
			params: { path: { id } },
			body: { workspace_id: this.workspaceId }
		});
		if (error) throw new Error('Could not restore Cloud Video Project');
		await this.invalidateProjectState(id);
	}
}
