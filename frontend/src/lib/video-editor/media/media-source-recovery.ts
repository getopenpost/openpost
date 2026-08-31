import { isLottieFile, parseLottieFileBytes } from '../lottie/metadata';
import { readBlob, removeEntry, writeBlob } from '../workspace-fs/fs-primitives';
import {
	updateMedia,
	validateMediaHandle,
	type MediaHandleValidation
} from '../workspace-fs/media';
import { mediaSourceByFileName, mediaThumbnailPath } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import { filmstripCache } from './filmstrip-client';
import { prepareMediaImportFile } from './media-file-types';
import { mediaLibraryKind } from './library-view';
import { revokeMediaObjectUrl } from './media-source';
import type { MediaSourceIssue } from './media-recovery';
import { mediaPool } from './pool.svelte';
import { probeMediaFile } from './probe-client';
import { clearProxyCache } from './proxy-client';
import type { MediaMetadata, VideoFrameRateMetrics } from './types';
import { clearWaveformCache } from './waveform-client';

interface ReplacementProbe {
	kind: 'video' | 'audio' | 'image' | 'lottie';
	duration: number;
	width: number;
	height: number;
	fps: number;
	frameRateMetrics?: VideoFrameRateMetrics;
	codec: string;
	audioCodec?: string;
	keyframeTimestamps?: number[];
	gopInterval?: number;
	lottieTotalFrames?: number;
	lottieMarkers?: MediaMetadata['lottieMarkers'];
	thumbnailBlob?: Blob;
}

export interface MediaSourceRecoveryRuntime {
	validateHandle(mediaId: string): Promise<MediaHandleValidation>;
	readWorkspaceSource(media: MediaMetadata): Promise<Blob | null>;
	prepareFile(file: File): Promise<File>;
	probeFile(file: File): Promise<ReplacementProbe>;
	writeWorkspaceSource(mediaId: string, file: File): Promise<void>;
	writeThumbnail(mediaId: string, thumbnail: Blob): Promise<void>;
	update(mediaId: string, updates: Partial<MediaMetadata>): Promise<MediaMetadata>;
	removeWorkspaceSource(mediaId: string, fileName: string): Promise<void>;
	invalidate(mediaId: string): Promise<void>;
	publish(media: MediaMetadata): void;
}

const CORE_MEDIA_TAGS = new Set(['video', 'audio', 'image', 'lottie']);

export async function requestMediaSourceAccess(media: MediaMetadata): Promise<boolean> {
	const handle = media.fileHandle;
	if (!handle) return false;
	const current = await handle.queryPermission?.({ mode: 'read' });
	if (current === 'granted') return true;
	return (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
}

async function probeReplacement(file: File): Promise<ReplacementProbe> {
	if (isLottieFile(file)) {
		const lottie = parseLottieFileBytes(new Uint8Array(await file.arrayBuffer()));
		if (!lottie) throw new Error('This file is not a valid Lottie animation.');
		const { renderLottieThumbnail } = await import('../lottie/frame-provider');
		return {
			kind: 'lottie',
			duration: lottie.durationSeconds,
			width: lottie.width,
			height: lottie.height,
			fps: lottie.frameRate,
			codec: 'lottie',
			lottieTotalFrames: lottie.totalFrames,
			lottieMarkers: lottie.markers,
			thumbnailBlob:
				(await renderLottieThumbnail(file, lottie.width, lottie.height, lottie.totalFrames)) ??
				undefined
		};
	}

	const probe = await probeMediaFile(file);
	return {
		kind: probe.kind,
		duration: probe.durationSeconds,
		width: probe.width,
		height: probe.height,
		fps: probe.fps,
		frameRateMetrics: probe.frameRateMetrics,
		codec: probe.videoCodec ?? '',
		audioCodec: probe.audioCodec,
		audioCodecSupported: probe.audioCodecSupported,
		keyframeTimestamps: probe.keyframeTimestamps,
		gopInterval: probe.gopInterval,
		thumbnailBlob: probe.thumbnailBlob
	};
}

function replacementTags(media: MediaMetadata, kind: ReplacementProbe['kind']): string[] {
	return [...new Set([...media.tags.filter((tag) => !CORE_MEDIA_TAGS.has(tag)), kind])];
}

async function invalidateDerivedMedia(mediaId: string): Promise<void> {
	revokeMediaObjectUrl(mediaId);
	clearProxyCache(mediaId);
	const { animatedImageCache } = await import('./animated-image-client');
	await Promise.allSettled([
		clearWaveformCache(mediaId),
		filmstripCache.clearMedia(mediaId),
		animatedImageCache.clearMedia(mediaId)
	]);
}

export function createMediaSourceRecovery(runtime: MediaSourceRecoveryRuntime) {
	async function validateMediaSource(media: MediaMetadata): Promise<MediaSourceIssue | null> {
		if (media.storageType === 'handle') {
			const validation = await runtime.validateHandle(media.id);
			switch (validation.kind) {
				case 'ok':
					return null;
				case 'permission':
					return { mediaId: media.id, fileName: media.fileName, kind: 'permission' };
				case 'changed':
					return { mediaId: media.id, fileName: media.fileName, kind: 'changed' };
				default:
					return { mediaId: media.id, fileName: media.fileName, kind: 'missing' };
			}
		}

		const source = await runtime.readWorkspaceSource(media);
		return source ? null : { mediaId: media.id, fileName: media.fileName, kind: 'missing' };
	}

	async function scanMediaSourceIssues(
		media: readonly MediaMetadata[]
	): Promise<MediaSourceIssue[]> {
		const results = await Promise.all(media.map((entry) => validateMediaSource(entry)));
		return results.filter((issue): issue is MediaSourceIssue => issue !== null);
	}

	async function relinkMediaSource(
		media: MediaMetadata,
		handle: FileSystemFileHandle
	): Promise<MediaMetadata> {
		const selected = await handle.getFile();
		const prepared = await runtime.prepareFile(selected);
		const probe = await runtime.probeFile(prepared);
		const existingKind = mediaLibraryKind(media);
		if (existingKind !== probe.kind) {
			throw new Error(`Choose a ${existingKind} file to replace ${media.fileName}.`);
		}

		const converted = prepared.name !== selected.name;
		const storageType = media.storageType === 'workspace' || converted ? 'workspace' : 'handle';
		const nextHandle = storageType === 'handle' ? handle : undefined;

		if (storageType === 'workspace') {
			await runtime.writeWorkspaceSource(media.id, prepared);
		}
		if (probe.thumbnailBlob) {
			await runtime.writeThumbnail(media.id, probe.thumbnailBlob);
		}

		const updated = await runtime.update(media.id, {
			storageType,
			fileHandle: nextHandle,
			fileLastModified: selected.lastModified,
			fileName: prepared.name,
			fileSize: prepared.size,
			mimeType: prepared.type || 'application/octet-stream',
			duration: probe.duration,
			width: probe.width,
			height: probe.height,
			fps: probe.fps,
			frameRateMetrics: probe.frameRateMetrics,
			codec: probe.codec,
			audioCodec: probe.audioCodec,
			audioCodecSupported: probe.audioCodecSupported,
			keyframeTimestamps: probe.keyframeTimestamps,
			gopInterval: probe.gopInterval,
			lottieTotalFrames: probe.lottieTotalFrames,
			lottieMarkers: probe.lottieMarkers,
			bitrate: Math.round((prepared.size * 8) / Math.max(probe.duration, 1)),
			tags: replacementTags(media, probe.kind)
		});

		if (media.storageType === 'workspace' && media.fileName !== prepared.name) {
			await runtime.removeWorkspaceSource(media.id, media.fileName);
		}

		await runtime.invalidate(media.id);
		runtime.publish(updated);
		return updated;
	}

	return { validateMediaSource, scanMediaSourceIssues, relinkMediaSource };
}

const productionRuntime: MediaSourceRecoveryRuntime = {
	validateHandle: validateMediaHandle,
	readWorkspaceSource: (media) =>
		readBlob(requireWorkspaceRoot(), mediaSourceByFileName(media.id, media.fileName)),
	prepareFile: prepareMediaImportFile,
	probeFile: probeReplacement,
	writeWorkspaceSource: (mediaId, file) =>
		writeBlob(requireWorkspaceRoot(), mediaSourceByFileName(mediaId, file.name), file),
	writeThumbnail: (mediaId, thumbnail) =>
		writeBlob(requireWorkspaceRoot(), mediaThumbnailPath(mediaId), thumbnail),
	update: updateMedia,
	removeWorkspaceSource: (mediaId, fileName) =>
		removeEntry(requireWorkspaceRoot(), mediaSourceByFileName(mediaId, fileName)),
	invalidate: invalidateDerivedMedia,
	publish: (media) => {
		mediaPool.upsert(media, 'ready');
		mediaPool.notifyThumbnailsChanged();
	}
};

const productionRecovery = createMediaSourceRecovery(productionRuntime);
export const validateMediaSource = productionRecovery.validateMediaSource;
export const scanMediaSourceIssues = productionRecovery.scanMediaSourceIssues;
export const relinkMediaSource = productionRecovery.relinkMediaSource;
