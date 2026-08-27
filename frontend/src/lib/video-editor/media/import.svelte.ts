/**
 * Import orchestration: file picker/drop → probe → workspace record.
 *
 * Copy mode writes source bytes into `media/{id}/{sanitizedName}` (collected
 * source). Link mode stashes the FileSystemFileHandle in the handles
 * registry (linked source) and mirrors nothing. Thumbnails land at
 * `media/{id}/thumbnail.jpg`. Records join the pool store optimistically.
 *
 * Adapted from FreeCut (MIT) media-library import, trimmed to v1.
 */

import { createLogger } from '../workspace-fs/logger';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import { writeBlob, writeJsonAtomic } from '../workspace-fs/fs-primitives';
import {
	mediaMetadataPath,
	mediaSourceByFileName,
	mediaThumbnailPath,
	sanitizeWorkspaceFileName
} from '../workspace-fs/paths';
import { associateMediaWithProject, removeMediaFromProject } from '../workspace-fs/project-media';
import { createMedia, deleteMedia } from '../workspace-fs/media';
import type { MediaAttribution, MediaMetadata } from './types';
import { probeMediaFile } from './probe-client';
import { mediaPool } from './pool.svelte';
import { reconcileSystemAudioWithProbe } from './recording-capture-schema';
import { isLottieFile, parseLottieFileBytes } from '../lottie/metadata';
import {
	effectiveMediaStorageMode,
	fileWithInferredMediaType,
	prepareMediaImportFile
} from './media-file-types';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';
import { m } from '$lib/paraglide/messages';

const logger = createLogger('MediaImport');

/** Remove a newly created generated asset that has not been exposed outside this project. */
export async function rollbackNewGeneratedMedia(projectId: string, mediaId: string): Promise<void> {
	mediaPool.remove(mediaId);
	await removeMediaFromProject(projectId, mediaId).catch((error) => {
		logger.warn(`Could not remove generated media ${mediaId} from the project`, error);
	});
	await deleteMedia(mediaId).catch((error) => {
		logger.warn(`Could not remove generated media ${mediaId} from workspace storage`, error);
	});
}

export interface ImportOptions {
	projectId: string;
	/** 'copy' collects bytes into the workspace; 'link' references in place. */
	storageMode: 'copy' | 'link';
	attribution?: MediaAttribution;
	tags?: string[];
	onUnsupportedAudio?: (request: UnsupportedAudioImportRequest) => Promise<'import' | 'cancel'>;
}

export interface UnsupportedAudioImportRequest {
	fileName: string;
	codec: string;
}

export class MediaImportCancelledError extends Error {
	constructor() {
		super('Media import cancelled.');
		this.name = 'MediaImportCancelledError';
	}
}

export interface GeneratedImageImportOptions {
	projectId: string;
	/** Optional renderer assertion. Decoded source dimensions remain authoritative. */
	width?: number;
	height?: number;
	tags?: string[];
}

export interface GeneratedAudioImportOptions {
	projectId: string;
	duration: number;
	tags?: string[];
	capture?: import('./types').RecordingCaptureMetadata;
}

export interface GeneratedVideoImportOptions {
	projectId: string;
	tags?: string[];
	capture?: import('./types').RecordingCaptureMetadata;
}

export type RecordedAudioImportOptions = GeneratedAudioImportOptions;

async function writeFileForHandle(
	handle: FileSystemFileHandle
): Promise<{ file: File; lastModified: number }> {
	const file = await handle.getFile();
	return { file, lastModified: file.lastModified };
}

/**
 * Import one dropped/picked handle into the project and pool.
 * Resolves with the media id; pool entry transitions importing → ready/failed.
 */
export async function importFile(
	handle: FileSystemFileHandle,
	options: ImportOptions
): Promise<string> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const { storageMode, projectId } = options;
	const taskId = mediaTaskId('import', id);

	mediaPool.upsert(
		{
			id,
			storageType: storageMode === 'copy' ? 'workspace' : 'handle',
			fileName: handle.name,
			fileSize: 0,
			mimeType: '',
			duration: 0,
			width: 0,
			height: 0,
			fps: 0,
			codec: '',
			bitrate: 0,
			tags: []
		},
		'importing',
		0
	);
	const taskRevision = mediaTasks.start({
		id: taskId,
		kind: 'import',
		mediaId: id,
		label: handle.name,
		stage: 'reading',
		progress: 0.05
	});

	try {
		const resolved = await writeFileForHandle(handle);
		const file = await prepareMediaImportFile(resolved.file);
		mediaTasks.update(taskId, { stage: 'probing', progress: 0.2 }, taskRevision);
		const fileLastModified = resolved.lastModified;
		const effectiveStorageMode = effectiveMediaStorageMode(storageMode, resolved.file, file);
		const storedHandle = effectiveStorageMode === 'link' ? handle : undefined;

		let thumbnailBlob: Blob | undefined;
		let metadata: MediaMetadata;
		if (isLottieFile(file)) {
			const lottie = parseLottieFileBytes(new Uint8Array(await file.arrayBuffer()));
			if (!lottie) throw new Error('This file is not a valid Lottie animation.');
			metadata = {
				id,
				storageType: effectiveStorageMode === 'copy' ? 'workspace' : 'handle',
				fileHandle: storedHandle,
				fileLastModified,
				fileName: file.name,
				fileSize: file.size,
				mimeType:
					file.type || (/\.lottie$/i.test(file.name) ? 'application/zip' : 'application/json'),
				duration: lottie.durationSeconds,
				width: lottie.width,
				height: lottie.height,
				fps: lottie.frameRate,
				codec: 'lottie',
				bitrate: Math.round((file.size * 8) / Math.max(lottie.durationSeconds, 1)),
				lottieTotalFrames: lottie.totalFrames,
				lottieMarkers: lottie.markers,
				attribution: options.attribution,
				tags: [...new Set(['lottie', ...(options.tags ?? [])])]
			};
			const { renderLottieThumbnail } = await import('../lottie/frame-provider');
			thumbnailBlob =
				(await renderLottieThumbnail(file, lottie.width, lottie.height, lottie.totalFrames)) ??
				undefined;
		} else {
			const probe = await probeMediaFile(file);
			if (probe.audioCodecSupported === false) {
				const decision = await options.onUnsupportedAudio?.({
					fileName: file.name,
					codec: probe.audioCodec ?? 'unknown'
				});
				if (decision !== 'import') throw new MediaImportCancelledError();
			}
			metadata = {
				id,
				storageType: effectiveStorageMode === 'copy' ? 'workspace' : 'handle',
				fileHandle: storedHandle,
				fileLastModified,
				fileName: file.name,
				fileSize: file.size,
				mimeType: file.type || 'application/octet-stream',
				duration: probe.durationSeconds,
				width: probe.width,
				height: probe.height,
				fps: probe.fps,
				codec: probe.videoCodec ?? '',
				videoCodecSupported: probe.videoCodecSupported,
				bitrate: Math.round((file.size * 8) / Math.max(probe.durationSeconds, 1)),
				audioCodec: probe.audioCodec,
				audioCodecSupported: probe.audioCodecSupported,
				keyframeTimestamps: probe.keyframeTimestamps,
				gopInterval: probe.gopInterval,
				animationFrameCount: probe.animationFrameCount,
				attribution: options.attribution,
				tags: [...new Set([probe.kind, ...(options.tags ?? [])])]
			};
			thumbnailBlob = probe.thumbnailBlob;
		}

		if (effectiveStorageMode === 'copy') {
			mediaTasks.update(taskId, { stage: 'copying', progress: 0.65 }, taskRevision);
			await writeBlob(root, mediaSourceByFileName(id, file.name), file);
		}

		mediaTasks.update(taskId, { stage: 'saving', progress: 0.82 }, taskRevision);
		await createMedia(metadata);
		if (thumbnailBlob) {
			await writeBlob(root, mediaThumbnailPath(id), thumbnailBlob);
		}
		await writeJsonAtomic(root, mediaMetadataPath(id), {
			...metadata,
			fileHandle: undefined
		});
		await associateMediaWithProject(projectId, id);

		mediaTasks.update(taskId, { progress: 1 }, taskRevision);
		mediaPool.upsert({ ...metadata, fileHandle: storedHandle }, 'ready');
		return id;
	} catch (error) {
		if (error instanceof MediaImportCancelledError) {
			mediaPool.remove(id);
			throw error;
		}
		logger.error(`importFile(${handle.name}) failed`, error);
		mediaPool.setStatus(id, 'failed', error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		mediaTasks.finish(taskId, taskRevision);
	}
}

/** Copy an in-memory file into the workspace through the normal import path. */
export async function importCopiedFile(
	file: File,
	options: Omit<ImportOptions, 'storageMode'>
): Promise<string> {
	// SAFETY: importFile only reads name, kind, and getFile from a copy-only handle.
	const handle = {
		name: file.name,
		kind: 'file',
		getFile: async () => file
	} as FileSystemFileHandle;
	return importFile(handle, { ...options, storageMode: 'copy' });
}

const MAX_REMOTE_LOTTIE_BYTES = 20 * 1024 * 1024;

/** Download one public LottieFiles animation into the local workspace. */
export async function importRemoteLottie(options: {
	projectId: string;
	url: string;
	fileName: string;
	attribution: MediaAttribution;
}): Promise<string> {
	const source = new URL(options.url);
	if (source.protocol !== 'https:' || source.hostname !== 'assets-v2.lottiefiles.com') {
		throw new Error('The animation source is not a trusted LottieFiles asset.');
	}
	const response = await fetch(source, {
		credentials: 'omit',
		referrerPolicy: 'no-referrer'
	});
	if (!response.ok) throw new Error(`Animation download failed (${response.status}).`);
	const declaredSize = Number(response.headers.get('content-length') ?? 0);
	if (declaredSize > MAX_REMOTE_LOTTIE_BYTES) {
		throw new Error('The animation is larger than the 20 MB import limit.');
	}
	const blob = await response.blob();
	if (blob.size > MAX_REMOTE_LOTTIE_BYTES) {
		throw new Error('The animation is larger than the 20 MB import limit.');
	}
	const baseName = sanitizeWorkspaceFileName(options.fileName).replace(/\.(?:json|lottie)$/i, '');
	const file = new File([blob], `${baseName || 'lottiefiles-animation'}.lottie`, {
		type: 'application/zip',
		lastModified: Date.now()
	});
	return importCopiedFile(file, {
		projectId: options.projectId,
		attribution: options.attribution
	});
}

export { resolveMediaBlob } from './resolve-media-blob';

/** Save a renderer-created image into the workspace media pool. */
export async function importGeneratedImage(
	file: File,
	options: GeneratedImageImportOptions
): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	const resolvedFile = fileWithInferredMediaType(file);
	if (!resolvedFile.type.startsWith('image/')) {
		throw new Error(
			`Generated file must be an image. Received "${resolvedFile.type || 'unknown'}".`
		);
	}
	const probe = await probeMediaFile(resolvedFile);
	if (probe.kind !== 'image' || !(probe.width > 0) || !(probe.height > 0)) {
		throw new Error('The generated file does not contain a usable image.');
	}
	const expectedWidth = Number.isFinite(options.width) ? Math.round(options.width ?? 0) : 0;
	const expectedHeight = Number.isFinite(options.height) ? Math.round(options.height ?? 0) : 0;
	if (
		(expectedWidth > 0 && expectedWidth !== probe.width) ||
		(expectedHeight > 0 && expectedHeight !== probe.height)
	) {
		throw new Error(
			`Generated image dimensions do not match its pixels (${probe.width}x${probe.height}).`
		);
	}
	const id = crypto.randomUUID();
	const fileName = sanitizeWorkspaceFileName(resolvedFile.name);
	const metadata: MediaMetadata = {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: resolvedFile.size,
		mimeType: resolvedFile.type,
		duration: 0,
		width: probe.width,
		height: probe.height,
		fps: 0,
		codec: resolvedFile.type.slice('image/'.length).split(';', 1)[0] || 'unknown',
		bitrate: 0,
		tags: [...new Set(['image', ...(options.tags ?? [])])]
	};

	try {
		await writeBlob(root, mediaSourceByFileName(id, fileName), resolvedFile);
		await createMedia(metadata);
		if (probe.thumbnailBlob) {
			await writeBlob(root, mediaThumbnailPath(id), probe.thumbnailBlob);
		}
		await writeJsonAtomic(root, mediaMetadataPath(id), metadata);
		await associateMediaWithProject(options.projectId, id);
		mediaPool.upsert(metadata, 'ready');
		return metadata;
	} catch (error) {
		await rollbackNewGeneratedMedia(options.projectId, id);
		throw error;
	}
}

/** Save a renderer-created video as an ordinary, editable workspace source. */
export async function importGeneratedVideo(
	file: File,
	options: GeneratedVideoImportOptions
): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const fileName = sanitizeWorkspaceFileName(file.name);
	const probe = await probeMediaFile(file);
	if (probe.kind !== 'video' || !(probe.width > 0) || !(probe.height > 0)) {
		throw new Error('The generated file does not contain a usable video track.');
	}
	const duration = Math.max(0, probe.durationSeconds);
	let capture = options.capture;
	if (capture?.systemAudio) {
		const reconciled = reconcileSystemAudioWithProbe(capture.systemAudio, probe.hasAudio);
		capture = {
			...capture,
			systemAudio: {
				requested: capture.systemAudio.requested,
				active: reconciled.active,
				status: reconciled.status
			}
		};
	}
	const metadata: MediaMetadata = {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: file.size,
		mimeType: file.type || 'video/mp4',
		duration,
		width: probe.width,
		height: probe.height,
		fps: probe.fps,
		codec: probe.videoCodec ?? '',
		videoCodecSupported: probe.videoCodecSupported,
		bitrate: probe.bitrate || (duration > 0 ? Math.round((file.size * 8) / duration) : 0),
		audioCodec: probe.audioCodec,
		audioCodecSupported: probe.audioCodecSupported,
		keyframeTimestamps: probe.keyframeTimestamps,
		gopInterval: probe.gopInterval,
		tags: [...new Set(['video', ...(options.tags ?? [])])],
		capture
	};

	try {
		await writeBlob(root, mediaSourceByFileName(id, fileName), file);
		await createMedia(metadata);
		if (probe.thumbnailBlob) {
			await writeBlob(root, mediaThumbnailPath(id), probe.thumbnailBlob);
		}
		await writeJsonAtomic(root, mediaMetadataPath(id), metadata);
		await associateMediaWithProject(options.projectId, id);
		mediaPool.upsert(metadata, 'ready');
		return metadata;
	} catch (error) {
		await rollbackNewGeneratedMedia(options.projectId, id);
		throw error;
	}
}

async function importWorkspaceAudio(
	file: File,
	options: GeneratedAudioImportOptions,
	baseTags: string[],
	probe?: { audioCodec?: string; bitrate?: number }
): Promise<MediaMetadata> {
	const root = requireWorkspaceRoot();
	const id = crypto.randomUUID();
	const fileName = sanitizeWorkspaceFileName(file.name);
	const duration = Math.max(0, options.duration);
	const metadata: MediaMetadata = {
		id,
		storageType: 'workspace',
		fileName,
		fileSize: file.size,
		mimeType: file.type || 'audio/wav',
		duration,
		width: 0,
		height: 0,
		fps: 0,
		codec: probe?.audioCodec ?? '',
		bitrate:
			probe?.bitrate && probe.bitrate > 0
				? probe.bitrate
				: duration > 0
					? Math.round((file.size * 8) / duration)
					: 0,
		audioCodec: probe?.audioCodec ?? (file.type === 'audio/wav' ? 'pcm_f32le' : undefined),
		audioCodecSupported: true,
		tags: [...new Set(['audio', ...baseTags, ...(options.tags ?? [])])],
		capture: options.capture
	};

	try {
		await writeBlob(root, mediaSourceByFileName(id, fileName), file);
		await createMedia(metadata);
		await associateMediaWithProject(options.projectId, id);
		mediaPool.upsert(metadata, 'ready');
		return metadata;
	} catch (error) {
		await rollbackNewGeneratedMedia(options.projectId, id);
		throw error;
	}
}

/** Save locally generated speech or music into the workspace media pool. */
export async function importGeneratedAudio(
	file: File,
	options: GeneratedAudioImportOptions
): Promise<MediaMetadata> {
	return importWorkspaceAudio(file, options, ['ai-generated']);
}

/** Save a microphone take without classifying it as AI-generated media. */
export async function importRecordedAudio(
	file: File,
	options: RecordedAudioImportOptions
): Promise<MediaMetadata> {
	let duration = options.duration;
	let probe: { audioCodec?: string; bitrate?: number } | undefined;
	try {
		const result = await probeMediaFile(file);
		if (
			result.kind === 'audio' &&
			Number.isFinite(result.durationSeconds) &&
			result.durationSeconds > 0
		) {
			duration = result.durationSeconds;
			probe = { audioCodec: result.audioCodec, bitrate: result.bitrate };
		}
	} catch (error) {
		logger.warn('Could not probe recorded audio; using decoded capture duration', error);
	}
	return importWorkspaceAudio(file, { ...options, duration }, ['recorded'], probe);
}

/** Open the platform file picker and import every selection. */
export async function importFromPicker(options: ImportOptions): Promise<string[]> {
	const handles = await window.showOpenFilePicker?.({
		multiple: true,
		types: [
			{
				description: m.video_editor_media_tab(),
				accept: {
					'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.m4v'],
					'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg'],
					'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
					'application/json': ['.json'],
					'application/zip': ['.lottie']
				}
			}
		]
	});
	if (!handles || handles.length === 0) return [];
	const ids: string[] = [];
	for (const handle of handles) {
		try {
			ids.push(await importFile(handle, options));
		} catch (error) {
			if (error instanceof MediaImportCancelledError) continue;
			// Per-file failure already surfaced via pool status; keep going.
		}
	}
	return ids;
}
