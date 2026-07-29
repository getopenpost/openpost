import {
	cloneVideoProject,
	type VideoProjectDocumentV1,
	type VideoSource
} from '@openpost/video-project';
import { uploadMediaFile } from '$lib/media-upload-client';
import { createCloudVideoProject, updateCloudVideoProject } from './api';
import { readProjectFile, saveLocalVideoProject } from './storage';
import type { LocalVideoProject } from './types';

export interface CloudSyncProgress {
	stage: 'hashing' | 'uploading' | 'saving';
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
	const cloudDocument = cloneVideoProject(local.document);
	const localDocument = cloneVideoProject(local.document);
	const localSources = Object.values(cloudDocument.sources).filter(
		(source) => source.locator.type === 'local-opfs'
	);
	const totalBytes = localSources.reduce((total, source) => total + source.size_bytes, 0);
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
		onProgress?.({
			stage: 'hashing',
			source_name: source.original_name,
			completed_bytes: completedBytes,
			total_bytes: totalBytes,
			fraction: totalBytes > 0 ? completedBytes / totalBytes : 0
		});
		const contentHash = source.content_hash || (await hashVideoSource(named, signal));
		const result = await uploadMediaFile({
			workspaceId: workspaceID,
			file: named,
			source: source.provenance ? 'stock_import' : 'video_studio_source',
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
		const cloudSource: VideoSource = {
			...source,
			content_hash: contentHash,
			locator: { type: 'openpost-media', media_id: result.id }
		};
		cloudDocument.sources[source.id] = cloudSource;
		localDocument.sources[source.id]!.content_hash = contentHash;
		completedBytes += source.size_bytes;
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
		state: 'cloud'
	});
}

export function hashVideoSource(file: File, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const id = crypto.randomUUID();
		const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
		const abort = () => {
			worker.terminate();
			reject(signal?.reason ?? new DOMException('Hashing cancelled.', 'AbortError'));
		};
		worker.onmessage = (event) => {
			const message = event.data as Record<string, unknown>;
			if (message.id !== id) return;
			if (message.type === 'complete') {
				signal?.removeEventListener('abort', abort);
				worker.terminate();
				resolve(String(message.sha256 ?? ''));
			} else if (message.type === 'error') {
				signal?.removeEventListener('abort', abort);
				worker.terminate();
				reject(new Error(String(message.message ?? 'The source hash could not be calculated.')));
			}
		};
		worker.onerror = (event) => {
			signal?.removeEventListener('abort', abort);
			worker.terminate();
			reject(new Error(event.message || 'The source hash worker failed.'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		worker.postMessage({ id, file });
	});
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
