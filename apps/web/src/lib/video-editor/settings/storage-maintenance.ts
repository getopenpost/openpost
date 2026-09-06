import { renderLottieThumbnail } from '../lottie/frame-provider';
import { filmstripCache } from '../media/filmstrip-client';
import { animatedImageCache } from '../media/animated-image-client';
import { resolveMediaBlob } from '../media/import.svelte';
import { mediaPool } from '../media/pool.svelte';
import { probeMediaFile } from '../media/probe-client';
import {
	cachedProxy,
	clearProxyCache,
	getAutomaticProxy,
	isAutomaticProxyCandidate
} from '../media/proxy-client';
import type { MediaMetadata } from '../media/types';
import { clearWaveformCache } from '../media/waveform-client';
import { clearPreviewDecoderPrewarm } from '../preview/decoder-prewarm-client';
import { writeBlob } from '../workspace-fs/fs-primitives';
import { mediaThumbnailPath } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';

export interface MaintenanceBatchResult {
	total: number;
	succeeded: number;
	failedMediaIds: string[];
}

export interface MaintenanceProgress {
	done: number;
	total: number;
	mediaId: string;
}

export interface StorageMaintenanceDependencies {
	clearPreviewFrames(): void;
	clearWaveform(mediaId: string): Promise<void>;
	clearFilmstrip(mediaId: string): Promise<void>;
	clearAnimatedImages(mediaId: string): Promise<void>;
	makeThumbnail(media: MediaMetadata): Promise<Blob>;
	writeThumbnail(mediaId: string, thumbnail: Blob): Promise<void>;
	notifyThumbnailsChanged(): void;
	isProxyCandidate(media: MediaMetadata): boolean;
	proxy(mediaId: string): Blob | null;
	generateProxy(media: MediaMetadata): Promise<Blob>;
	clearProxy(mediaId: string): boolean;
}

function batchResult(total: number, failedMediaIds: string[]): MaintenanceBatchResult {
	return { total, succeeded: Math.max(0, total - failedMediaIds.length), failedMediaIds };
}

async function runBatch<T extends { id: string }>(
	items: readonly T[],
	action: (item: T) => Promise<void>,
	onProgress?: (progress: MaintenanceProgress) => void
): Promise<MaintenanceBatchResult> {
	const failedMediaIds: string[] = [];
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index]!;
		try {
			await action(item);
		} catch {
			failedMediaIds.push(item.id);
		}
		onProgress?.({ done: index + 1, total: items.length, mediaId: item.id });
	}
	return batchResult(items.length, failedMediaIds);
}

function isVisualMedia(media: MediaMetadata): boolean {
	return (
		media.mimeType.startsWith('video/') ||
		media.mimeType.startsWith('image/') ||
		media.tags.includes('video') ||
		media.tags.includes('image') ||
		media.tags.includes('lottie')
	);
}

async function makeThumbnail(media: MediaMetadata): Promise<Blob> {
	const source = await resolveMediaBlob(media);
	if (media.tags.includes('lottie')) {
		const thumbnail = await renderLottieThumbnail(
			source,
			Math.max(1, media.width),
			Math.max(1, media.height),
			Math.max(1, media.lottieTotalFrames ?? Math.round(media.duration * media.fps))
		);
		if (!thumbnail) throw new Error('Lottie thumbnail rendering failed');
		return thumbnail;
	}
	const file = new File([source], media.fileName, {
		type: media.mimeType,
		lastModified: media.fileLastModified ?? Date.now()
	});
	const thumbnail = (await probeMediaFile(file)).thumbnailBlob;
	if (!thumbnail) throw new Error('Media thumbnail rendering failed');
	return thumbnail;
}

const browserDependencies: StorageMaintenanceDependencies = {
	clearPreviewFrames: clearPreviewDecoderPrewarm,
	clearWaveform: clearWaveformCache,
	clearFilmstrip: (mediaId) => filmstripCache.clearMedia(mediaId),
	clearAnimatedImages: (mediaId) => animatedImageCache.clearMedia(mediaId),
	makeThumbnail,
	writeThumbnail: (mediaId, thumbnail) =>
		writeBlob(requireWorkspaceRoot(), mediaThumbnailPath(mediaId), thumbnail),
	notifyThumbnailsChanged: () => mediaPool.notifyThumbnailsChanged(),
	isProxyCandidate: isAutomaticProxyCandidate,
	proxy: cachedProxy,
	generateProxy: (media) => getAutomaticProxy(media),
	clearProxy: clearProxyCache
};

export function createStorageMaintenance(dependencies: StorageMaintenanceDependencies) {
	function recommendedProxyMedia(media: readonly MediaMetadata[]): MediaMetadata[] {
		return media.filter(
			(item) => dependencies.isProxyCandidate(item) && dependencies.proxy(item.id) === null
		);
	}

	return {
		async clearProjectDerivedCaches(
			media: readonly MediaMetadata[],
			onProgress?: (progress: MaintenanceProgress) => void
		): Promise<MaintenanceBatchResult> {
			dependencies.clearPreviewFrames();
			return runBatch(
				media,
				async (item) => {
					await Promise.all([
						dependencies.clearWaveform(item.id),
						dependencies.clearFilmstrip(item.id),
						dependencies.clearAnimatedImages(item.id)
					]);
				},
				onProgress
			);
		},

		async regenerateProjectThumbnails(
			media: readonly MediaMetadata[],
			onProgress?: (progress: MaintenanceProgress) => void
		): Promise<MaintenanceBatchResult> {
			const visualMedia = media.filter(isVisualMedia);
			const result = await runBatch(
				visualMedia,
				async (item) => {
					await dependencies.writeThumbnail(item.id, await dependencies.makeThumbnail(item));
				},
				onProgress
			);
			if (result.succeeded > 0) dependencies.notifyThumbnailsChanged();
			return result;
		},

		recommendedProxyMedia,

		projectProxyCount(media: readonly MediaMetadata[]): number {
			return media.filter((item) => dependencies.proxy(item.id) !== null).length;
		},

		generateRecommendedProxies(
			media: readonly MediaMetadata[],
			onProgress?: (progress: MaintenanceProgress) => void
		): Promise<MaintenanceBatchResult> {
			return runBatch(
				recommendedProxyMedia(media),
				async (item) => {
					await dependencies.generateProxy(item);
				},
				onProgress
			);
		},

		deleteProjectProxies(
			media: readonly MediaMetadata[],
			onProgress?: (progress: MaintenanceProgress) => void
		): Promise<MaintenanceBatchResult> {
			const proxies = media.filter((item) => dependencies.proxy(item.id) !== null);
			return runBatch(
				proxies,
				async (item) => {
					dependencies.clearProxy(item.id);
				},
				onProgress
			);
		}
	};
}

export const storageMaintenance = createStorageMaintenance(browserDependencies);
export const {
	clearProjectDerivedCaches,
	deleteProjectProxies,
	generateRecommendedProxies,
	projectProxyCount,
	recommendedProxyMedia,
	regenerateProjectThumbnails
} = storageMaintenance;
