import { uploadMediaFile } from '$lib/media-upload-client';
import type { CloudVideoProjectRepository } from './project-repository';
import { hashBlob } from '../project-bundle/bundle-utils';
import { fileWithInferredMediaType, prepareMediaImportFile } from '../media/media-file-types';
import { probeMediaFile } from '../media/probe-client';
import { mediaPool } from '../media/pool.svelte';
import type { MediaMetadata } from '../media/types';

export interface CloudProjectAssetImportOptions<TDocument extends object> {
	projectId: string;
	repository: CloudVideoProjectRepository<TDocument>;
	onUnsupportedAudio?: (request: {
		fileName: string;
		codec: string;
	}) => Promise<'import' | 'cancel'>;
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
		const source = fileWithInferredMediaType(await handle.getFile());
		const file = await prepareMediaImportFile(source);
		const probe = await probeMediaFile(file);
		if (probe.audioCodecSupported === false) {
			const decision = await options.onUnsupportedAudio?.({
				fileName: file.name,
				codec: probe.audioCodec ?? 'unknown'
			});
			if (decision !== 'import') continue;
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
			tags: [probe.kind]
		};
		mediaPool.upsert(media, 'ready');
		imported.push(stableMediaId);
	}
	return imported;
}
