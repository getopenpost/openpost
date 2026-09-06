import { uploadMediaFile } from '$lib/media-upload-client';
import type { CloudVideoProjectRepository } from './project-repository';
import { hashBlob } from '../project-bundle/bundle-utils';
import { fileWithInferredMediaType, prepareMediaImportFile } from '../media/media-file-types';
import { probeMediaFile } from '../media/probe-client';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata, RecordingCaptureMetadata } from '../media/types';

export interface CloudProjectAssetImportOptions<TDocument extends object> {
	projectId: string;
	repository: CloudVideoProjectRepository<TDocument>;
	onUnsupportedAudio?: (request: {
		fileName: string;
		codec: string;
	}) => Promise<'import' | 'cancel'>;
}

export interface CloudProjectAssetFileOptions<
	TDocument extends object
> extends CloudProjectAssetImportOptions<TDocument> {
	file: File;
	tags?: string[];
	capture?: RecordingCaptureMetadata;
}

export async function importCloudProjectAssetFile<TDocument extends object>(
	options: CloudProjectAssetFileOptions<TDocument>
): Promise<MediaMetadata | null> {
	const source = fileWithInferredMediaType(options.file);
	const file = await prepareMediaImportFile(source);
	const probe = await probeMediaFile(file);
	if (probe.audioCodecSupported === false) {
		const decision = await options.onUnsupportedAudio?.({
			fileName: file.name,
			codec: probe.audioCodec ?? 'unknown'
		});
		if (decision !== 'import') return null;
	}
	const stableMediaId = crypto.randomUUID();
	const contentHash = await hashBlob(file);
	const projectAssetId = await options.repository.reserveAsset(options.projectId, {
		stableMediaId,
		fileName: file.name,
		mimeType: file.type || 'application/octet-stream',
		size: file.size,
		sha256: contentHash
	});
	const uploaded = await uploadMediaFile({
		workspaceId: options.repository.workspaceId,
		file,
		source: 'video_editor_source',
		assetKind: 'project_asset',
		retentionClass: 'temporary',
		projectAssetId,
		clientSHA256: contentHash,
		prepareVideo: false
	});
	const media: MediaMetadata = {
		id: stableMediaId,
		storageType: 'cloud',
		remoteUrl: uploaded.url,
		contentHash,
		fileName: file.name,
		fileSize: file.size,
		mimeType: file.type || 'application/octet-stream',
		duration: probe.durationSeconds,
		width: probe.width,
		height: probe.height,
		fps: probe.fps,
		frameRateMetrics: probe.frameRateMetrics,
		codec: probe.videoCodec ?? '',
		videoCodecSupported: probe.videoCodecSupported,
		bitrate: probe.bitrate ?? 0,
		audioCodec: probe.audioCodec,
		audioCodecSupported: probe.audioCodecSupported,
		keyframeTimestamps: probe.keyframeTimestamps,
		gopInterval: probe.gopInterval,
		animationFrameCount: probe.animationFrameCount,
		tags: [...new Set([probe.kind, ...(options.tags ?? [])])],
		capture: options.capture
	};
	mediaPool.upsert(media, 'ready');
	return media;
}

/** Upload a custom font as a project-owned asset without media probing. */
export async function importCloudProjectFontFile<TDocument extends object>(options: {
	projectId: string;
	repository: CloudVideoProjectRepository<TDocument>;
	file: File;
}): Promise<MediaMetadata> {
	const stableMediaId = crypto.randomUUID();
	const contentHash = await hashBlob(options.file);
	const projectAssetId = await options.repository.reserveAsset(options.projectId, {
		stableMediaId,
		fileName: options.file.name,
		mimeType: options.file.type || 'application/octet-stream',
		size: options.file.size,
		sha256: contentHash
	});
	const uploaded = await uploadMediaFile({
		workspaceId: options.repository.workspaceId,
		file: options.file,
		source: 'video_editor_source',
		assetKind: 'project_asset',
		retentionClass: 'temporary',
		projectAssetId,
		clientSHA256: contentHash,
		prepareVideo: false
	});
	const media: MediaMetadata = {
		id: stableMediaId,
		storageType: 'cloud',
		remoteUrl: uploaded.url,
		contentHash,
		fileName: options.file.name,
		fileSize: options.file.size,
		mimeType: options.file.type || 'application/octet-stream',
		duration: 0,
		width: 0,
		height: 0,
		fps: 0,
		codec: 'font',
		bitrate: 0,
		tags: ['font']
	};
	mediaPool.upsert(media, 'ready');
	return media;
}

export async function importCloudProjectAssetsFromPicker<TDocument extends object>(
	options: CloudProjectAssetImportOptions<TDocument>
): Promise<string[]> {
	if (!window.showOpenFilePicker) throw new Error('File picker is not available in this browser');
	const handles = await window.showOpenFilePicker({
		multiple: true,
		types: [
			{
				description: 'Media',
				accept: {
					'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
					'audio/*': ['.mp3', '.m4a', '.wav', '.ogg', '.flac'],
					'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif']
				}
			}
		]
	});
	const imported: string[] = [];
	for (const handle of handles) {
		const media = await importCloudProjectAssetFile({
			...options,
			file: await handle.getFile()
		});
		if (media) imported.push(media.id);
	}
	return imported;
}
