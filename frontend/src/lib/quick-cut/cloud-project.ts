import type { PortableQuickCutProjectDocument } from '@openpost/video-project';
import { uploadMediaFile } from '$lib/media-upload-client';
import {
	cloudVideoProjectFamily,
	CloudVideoProjectRepository,
	type CloudVideoProject
} from '$lib/video-editor/cloud/project-repository';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import { hashBlob } from '$lib/video-editor/project-bundle/bundle-utils';
import { deserializeProject } from './project';
import type {
	QuickCutProject,
	QuickCutSegment,
	QuickCutSource,
	QuickCutSourceMetadata
} from './types';

export type QuickCutCloudDocument = PortableQuickCutProjectDocument<
	QuickCutSourceMetadata,
	QuickCutSegment
>;

type QuickCutCloudMedia = Pick<MediaMetadata, 'id' | 'offlineUrl' | 'remoteUrl'>;

export interface QuickCutCloudRepository {
	readonly workspaceId: string;
	createWithId(
		id: string,
		name: string,
		document: QuickCutCloudDocument
	): Promise<CloudVideoProject<QuickCutCloudDocument>>;
	save(
		project: CloudVideoProject<QuickCutCloudDocument>,
		document: QuickCutCloudDocument
	): Promise<void>;
	listMedia(projectId: string): Promise<QuickCutCloudMedia[]>;
	reserveAsset(
		projectId: string,
		input: {
			stableMediaId: string;
			fileName: string;
			mimeType: string;
			size: number;
			sha256: string;
		}
	): Promise<string>;
}

export interface QuickCutCloudCatalogRepository extends QuickCutCloudRepository {
	list(includeTrash?: boolean): Promise<Array<CloudVideoProject<QuickCutCloudDocument>>>;
	get(projectId: string): Promise<CloudVideoProject<QuickCutCloudDocument>>;
}

export interface QuickCutCloudSession {
	project: CloudVideoProject<QuickCutCloudDocument>;
	availableAssetIds: Set<string>;
}

export interface QuickCutCloudRuntime {
	hash(file: File): Promise<string>;
	upload(input: {
		workspaceId: string;
		projectAssetId: string;
		file: File;
		sha256: string;
	}): Promise<void>;
}

export interface QuickCutCloudDownloadRuntime {
	download(url: string): Promise<Blob>;
	readCached?(url: string): Promise<Blob | null>;
}

const defaultRuntime: QuickCutCloudRuntime = {
	hash: hashBlob,
	async upload(input) {
		await uploadMediaFile({
			workspaceId: input.workspaceId,
			file: input.file,
			source: 'video_editor_source',
			assetKind: 'project_asset',
			retentionClass: 'temporary',
			projectAssetId: input.projectAssetId,
			clientSHA256: input.sha256,
			prepareVideo: false
		});
	}
};

const defaultDownloadRuntime: QuickCutCloudDownloadRuntime = {
	async download(url) {
		const response = await fetch(url, { credentials: 'include' });
		if (!response.ok) throw new Error(`Could not load Quick Cut source (${response.status})`);
		return response.blob();
	},
	async readCached(url) {
		if (typeof caches === 'undefined') return null;
		return (await caches.match(url))?.blob() ?? null;
	}
};

export function quickCutCloudDocument(project: QuickCutProject): QuickCutCloudDocument {
	return {
		id: project.id,
		name: project.name,
		schemaFamily: 'quick-cut',
		schemaVersion: 1,
		timeline: {
			sources: structuredClone(project.sources),
			segments: structuredClone(project.segments)
		},
		settings: {
			cutMode: project.cutMode,
			merge: project.merge,
			removeMarkedRanges: project.removeMarkedRanges
		},
		createdAt: project.createdAt,
		updatedAt: project.updatedAt
	};
}

export function quickCutProjectFromCloudDocument(document: QuickCutCloudDocument): QuickCutProject {
	if (document.schemaFamily !== 'quick-cut' || document.schemaVersion !== 1) {
		throw new Error('This Cloud Video Project is not a supported Quick Cut project');
	}
	return deserializeProject(
		JSON.stringify({
			version: 1,
			id: document.id,
			name: document.name,
			sources: document.timeline.sources,
			segments: document.timeline.segments,
			cutMode: document.settings.cutMode,
			merge: document.settings.merge,
			removeMarkedRanges: document.settings.removeMarkedRanges,
			createdAt: document.createdAt,
			updatedAt: document.updatedAt
		})
	);
}

export function isQuickCutCloudProject(project: CloudVideoProject<QuickCutCloudDocument>): boolean {
	return cloudVideoProjectFamily(project) === 'quick-cut';
}

export async function listQuickCutCloudProjects(
	repository: QuickCutCloudCatalogRepository
): Promise<Array<CloudVideoProject<QuickCutCloudDocument>>> {
	return (await repository.list()).filter(isQuickCutCloudProject);
}

export async function loadQuickCutCloudProject(
	repository: QuickCutCloudCatalogRepository,
	projectId: string,
	runtime: QuickCutCloudDownloadRuntime = defaultDownloadRuntime
): Promise<{
	project: QuickCutProject;
	sources: QuickCutSource[];
	session: QuickCutCloudSession;
}> {
	const remoteProject = await repository.get(projectId);
	const project = quickCutProjectFromCloudDocument(remoteProject.document);
	const media = await repository.listMedia(projectId);
	const mediaById = new Map(media.map((item) => [item.id, item]));
	const sources = await Promise.all(
		project.sources.map(async (source) => {
			const item = mediaById.get(source.id);
			if (!item) return { ...source };
			let blob: Blob | null = null;
			if (item.remoteUrl) {
				try {
					blob = await runtime.download(item.remoteUrl);
				} catch {
					blob = item.offlineUrl ? ((await runtime.readCached?.(item.offlineUrl)) ?? null) : null;
				}
			} else if (item.offlineUrl) {
				blob = (await runtime.readCached?.(item.offlineUrl)) ?? null;
			}
			if (!blob) throw new Error(`Source ${source.name} is unavailable on this device`);
			return {
				...source,
				file: new File([blob], source.name, {
					type: source.mimeType || blob.type,
					lastModified: source.lastModified
				})
			};
		})
	);
	return {
		project,
		sources,
		session: {
			project: remoteProject,
			availableAssetIds: new Set(media.map((item) => item.id))
		}
	};
}

export async function syncQuickCutCloudProject(
	repository: QuickCutCloudRepository,
	session: QuickCutCloudSession | null,
	project: QuickCutProject,
	sources: QuickCutSource[],
	runtime: QuickCutCloudRuntime = defaultRuntime
): Promise<QuickCutCloudSession> {
	const document = quickCutCloudDocument(project);
	const files = new Map<string, File>();
	for (const source of sources) {
		if (session?.availableAssetIds.has(source.id)) continue;
		files.set(source.id, await requiredSourceFile(source));
	}
	const current = session ?? (await createQuickCutCloudSession(repository, document));
	for (const source of sources) {
		if (current.availableAssetIds.has(source.id)) continue;
		const file = files.get(source.id) ?? (await requiredSourceFile(source));
		const sha256 = await runtime.hash(file);
		const projectAssetId = await repository.reserveAsset(project.id, {
			stableMediaId: source.id,
			fileName: file.name,
			mimeType: file.type || source.mimeType || 'application/octet-stream',
			size: file.size,
			sha256
		});
		await runtime.upload({
			workspaceId: repository.workspaceId,
			projectAssetId,
			file,
			sha256
		});
		current.availableAssetIds.add(source.id);
	}
	await repository.save(current.project, document);
	return current;
}

async function createQuickCutCloudSession(
	repository: QuickCutCloudRepository,
	document: QuickCutCloudDocument
): Promise<QuickCutCloudSession> {
	const project = await repository.createWithId(document.id, document.name, document);
	const media = await repository.listMedia(project.id);
	return {
		project,
		availableAssetIds: new Set(media.map((item) => item.id))
	};
}

async function requiredSourceFile(source: QuickCutSource): Promise<File> {
	if (source.file) return source.file;
	if (source.handle) return source.handle.getFile();
	throw new Error(
		`Source ${source.name} is missing. Reconnect the file before saving to OpenPost.`
	);
}

export function quickCutCloudRepository(
	workspaceId: string
): CloudVideoProjectRepository<QuickCutCloudDocument> {
	return new CloudVideoProjectRepository<QuickCutCloudDocument>(workspaceId);
}
