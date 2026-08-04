import {
	cloneVideoProject,
	projectWithReferencedSourcesOnly,
	referencedSourceIDs,
	type VideoProjectDocumentV1,
	type VideoSource
} from '@openpost/video-project';
import { uploadMediaFile } from '$lib/media-upload-client';
import { createCloudVideoProject, planVideoEditorSync, updateCloudVideoProject } from './api';
import { readProjectFile, saveLocalVideoProject } from './storage';
import { hashLocalFile } from './file-hash';
import type { LocalVideoProject } from './types';

export interface CloudSyncProgress {
	stage: 'hashing' | 'planning' | 'uploading' | 'saving';
	source_name?: string;
	completed_bytes: number;
	total_bytes: number;
	fraction: number;
}

export async function syncVideoProjectToOpenPost(
	local: LocalVideoProject,
	workspaceID: string,
	onProgress?: (progress: CloudSyncProgress) => void,
	signal?: AbortSignal
): Promise<LocalVideoProject> {
	const cloudDocument = projectWithReferencedSourcesOnly(local.document);
	const localDocument = cloneVideoProject(local.document);
	const referencedIDs = referencedSourceIDs(cloudDocument);
	const localSources = referencedIDs
		.map((sourceID) => cloudDocument.sources[sourceID])
		.filter(
			(source): source is VideoSource =>
				Boolean(source) &&
				source!.locator.type === 'local-opfs' &&
				!local.cloud_source_map?.[source!.id]
		);
	const totalBytes = localSources.reduce((total, source) => total + source.size_bytes, 0);
	const sourceFiles = new Map<string, File>();
	const sourceHashes = new Map<string, string>();
	let completedBytes = 0;
	for (const source of localSources) {
		signal?.throwIfAborted();
		const localPath = source.locator.type === 'local-opfs' ? source.locator.path : '';
		const file = await readProjectFile(localPath);
		if (!file) throw new Error(`${source.original_name} is missing from local project storage.`);
		const named = new File([file], source.original_name, {
			type: source.mime_type,
			lastModified: file.lastModified
		});
		sourceFiles.set(source.id, named);
		onProgress?.({
			stage: 'hashing',
			source_name: source.original_name,
			completed_bytes: completedBytes,
			total_bytes: totalBytes,
			fraction: totalBytes > 0 ? completedBytes / totalBytes : 0
		});
		const contentHash = source.content_hash || (await hashLocalFile(named, signal));
		sourceHashes.set(source.id, contentHash);
		localDocument.sources[source.id]!.content_hash = contentHash;
		completedBytes += source.size_bytes;
	}
	onProgress?.({
		stage: 'planning',
		completed_bytes: totalBytes,
		total_bytes: totalBytes,
		fraction: 1
	});
	const plan = await planVideoEditorSync(workspaceID, {
		project_id: local.cloud_project_id,
		sources: localSources.map((source) => ({
			source_id: source.id,
			sha256: sourceHashes.get(source.id)!,
			size_bytes: source.size_bytes,
			mime_type: source.mime_type,
			original_name: source.original_name
		}))
	});
	if (!plan.allowed) {
		throw new Error(plan.reason || 'This workspace does not have enough cloud storage.');
	}
	const cloudSourceMap: Record<string, string> = {
		...(local.cloud_source_map ?? {}),
		...Object.fromEntries((plan.reused ?? []).map((reuse) => [reuse.source_id, reuse.media_id]))
	};
	const missing = new Set(plan.missing_source_ids ?? []);
	const mediaByHash = new Map<string, string>();
	completedBytes = 0;
	for (const source of localSources) {
		signal?.throwIfAborted();
		const contentHash = sourceHashes.get(source.id)!;
		if (cloudSourceMap[source.id]) {
			completedBytes += source.size_bytes;
			continue;
		}
		const sameUpload = mediaByHash.get(contentHash);
		if (sameUpload) {
			cloudSourceMap[source.id] = sameUpload;
			completedBytes += source.size_bytes;
			continue;
		}
		if (!missing.has(source.id)) {
			throw new Error(`OpenPost did not return a cloud mapping for ${source.original_name}.`);
		}
		const named = sourceFiles.get(source.id);
		if (!named) throw new Error(`${source.original_name} is missing from local project storage.`);
		const result = await uploadMediaFile({
			workspaceId: workspaceID,
			file: named,
			source: source.provenance ? 'stock_import' : 'video_editor_source',
			stockProvenance: source.provenance,
			videoProjectId: local.cloud_project_id,
			clientSHA256: contentHash,
			prepareVideo: false,
			signal,
			onProgress: (progress) => {
				onProgress?.({
					stage: 'uploading',
					source_name: source.original_name,
					completed_bytes:
						completedBytes +
						Math.round(Math.max(0, Math.min(1, progress.fraction)) * source.size_bytes),
					total_bytes: totalBytes,
					fraction:
						totalBytes > 0
							? (completedBytes +
									Math.round(Math.max(0, Math.min(1, progress.fraction)) * source.size_bytes)) /
								totalBytes
							: 1
				});
			}
		});
		cloudSourceMap[source.id] = result.id;
		mediaByHash.set(contentHash, result.id);
		completedBytes += source.size_bytes;
	}
	for (const sourceID of referencedIDs) {
		const source = cloudDocument.sources[sourceID];
		if (!source || source.locator.type === 'openpost-media') continue;
		const mediaID = cloudSourceMap[sourceID];
		if (!mediaID) throw new Error(`${source.original_name} has not been synchronized to OpenPost.`);
		cloudDocument.sources[sourceID] = {
			...source,
			content_hash: sourceHashes.get(sourceID) ?? source.content_hash,
			locator: { type: 'openpost-media', media_id: mediaID }
		};
	}
	onProgress?.({
		stage: 'saving',
		completed_bytes: totalBytes,
		total_bytes: totalBytes,
		fraction: 1
	});
	const response = local.cloud_project_id
		? await updateCloudVideoProject(
				local.cloud_project_id,
				local.cloud_revision ?? 1,
				cloudDocument
			)
		: await createCloudVideoProject(workspaceID, cloudDocument);
	return await saveLocalVideoProject({
		...local,
		document: localDocument,
		cloud_project_id: response.id,
		cloud_revision: response.revision,
		cloud_source_map: cloudSourceMap,
		unsynced_source_ids: referencedSourceIDs(localDocument).filter((sourceID) => {
			const source = localDocument.sources[sourceID];
			return source?.locator.type === 'local-opfs' && !cloudSourceMap[sourceID];
		}),
		state: 'cloud'
	});
}

export function hashVideoSource(file: File, signal?: AbortSignal): Promise<string> {
	return hashLocalFile(file, signal);
}

export function cloudDocumentForTest(
	document: VideoProjectDocumentV1,
	mediaBySourceID: Record<string, string>
): VideoProjectDocumentV1 {
	const next = cloneVideoProject(document);
	for (const [sourceID, mediaID] of Object.entries(mediaBySourceID)) {
		const source = next.sources[sourceID];
		if (source) source.locator = { type: 'openpost-media', media_id: mediaID };
	}
	return next;
}
