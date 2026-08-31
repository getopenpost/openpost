/** Scene analysis client and persistent cache coordinator. */

import { resolveMediaBlob } from '../import.svelte';
import type { MediaMetadata } from '../types';
import {
	getSceneAnalysis,
	saveSceneAnalysis,
	saveSceneThumbnail,
	sceneAnalysisMatchesMedia
} from '../../workspace-fs/scene-analysis';
import { readBlob } from '../../workspace-fs/fs-primitives';
import { mediaThumbnailPath } from '../../workspace-fs/paths';
import { requireWorkspaceRoot } from '../../workspace-fs/root';
import type {
	SceneAnalysisWorkerComplete,
	SceneAnalysisWorkerResponse
} from './scene-analysis.worker';
import type { SceneCut } from './scene-types';
import type { SceneAnalysis, SceneAnalysisProgress } from './types';

export const SCENE_BROWSER_DETECTOR_VERSION = 2;

interface AnalyzeSceneOptions {
	signal?: AbortSignal;
	force?: boolean;
	onProgress?: (progress: SceneAnalysisProgress) => void;
}

export function isSceneAnalyzableMedia(media: MediaMetadata): boolean {
	return (
		media.tags.includes('video') ||
		media.mimeType.startsWith('video/') ||
		media.tags.includes('image') ||
		media.mimeType.startsWith('image/')
	);
}

function isImageMedia(media: MediaMetadata): boolean {
	return media.tags.includes('image') || media.mimeType.startsWith('image/');
}

/** Parsed abort reason string from `AbortSignal.reason`. */
type AbortReasonText = string;

function parseAbortReason(reason: unknown): AbortReasonText | undefined {
	return typeof reason === 'string' ? reason : undefined;
}

function abortError(reason?: string): DOMException {
	return new DOMException(reason ?? 'Scene analysis cancelled', 'AbortError');
}

async function boundedImageThumbnail(source: Blob, signal?: AbortSignal): Promise<Blob> {
	const bitmap = await createImageBitmap(source);
	try {
		if (signal?.aborted) throw abortError(parseAbortReason(signal.reason));
		const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Unable to draw the image analysis thumbnail');
		context.drawImage(bitmap, 0, 0, width, height);
		return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
	} finally {
		bitmap.close();
	}
}

async function runWorker(
	media: MediaMetadata,
	signal: AbortSignal | undefined,
	onProgress: AnalyzeSceneOptions['onProgress'],
	includeThumbnails = true
): Promise<SceneAnalysisWorkerComplete> {
	const blob = await resolveMediaBlob(media);
	const worker = new Worker(new URL('./scene-analysis.worker.ts', import.meta.url), {
		type: 'module'
	});
	const requestId = crypto.randomUUID();
	try {
		return await new Promise<SceneAnalysisWorkerComplete>((resolve, reject) => {
			const onAbort = () => {
				worker.postMessage({ type: 'abort', requestId });
				reject(abortError(parseAbortReason(signal?.reason)));
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener('abort', onAbort, { once: true });
			worker.onerror = (event) => {
				signal?.removeEventListener('abort', onAbort);
				reject(new Error(event.message || 'Scene analysis worker failed'));
			};
			worker.onmessage = (event: MessageEvent<SceneAnalysisWorkerResponse>) => {
				const message = event.data;
				if (message.requestId !== requestId) return;
				if (message.type === 'progress') {
					onProgress?.({
						stage: message.stage,
						percent: message.percent,
						completed: message.completed,
						total: message.total
					});
					return;
				}
				signal?.removeEventListener('abort', onAbort);
				if (message.type === 'error') reject(new Error(message.error));
				else resolve(message);
			};
			worker.postMessage({
				type: 'analyze',
				requestId,
				blob,
				includeThumbnails
			});
		});
	} finally {
		worker.terminate();
	}
}

async function analyzeFresh(
	media: MediaMetadata,
	options: AnalyzeSceneOptions
): Promise<SceneAnalysis> {
	if (isImageMedia(media)) return analyzeImage(media, options);
	const result = await runWorker(media, options.signal, options.onProgress);
	const scenes = await Promise.all(
		result.scenes.map(async (scene) => {
			const thumbRelPath = await saveSceneThumbnail(media.id, scene.index, scene.thumbnail);
			return {
				id: `${media.id}:${scene.index}`,
				mediaId: media.id,
				index: scene.index,
				startSec: scene.startSec,
				endSec: scene.endSec,
				timeSec: scene.timeSec,
				text: '',
				thumbRelPath,
				palette: scene.palette
			};
		})
	);
	const analysis: SceneAnalysis = {
		schemaVersion: 1,
		detectorVersion: SCENE_BROWSER_DETECTOR_VERSION,
		mediaId: media.id,
		contentHash: media.contentHash,
		sourceFileSize: media.fileSize,
		sourceLastModified: media.fileLastModified,
		method: 'adaptive',
		sampleIntervalSec: 0,
		analyzedAt: Date.now(),
		scenes
	};
	await saveSceneAnalysis(analysis);
	return analysis;
}

async function analyzeImage(
	media: MediaMetadata,
	options: AnalyzeSceneOptions
): Promise<SceneAnalysis> {
	if (options.signal?.aborted) throw abortError(parseAbortReason(options.signal.reason));
	options.onProgress?.({ stage: 'thumbnails', percent: 0, completed: 0, total: 1 });
	const thumbnail =
		(await readBlob(requireWorkspaceRoot(), mediaThumbnailPath(media.id))) ??
		(await boundedImageThumbnail(await resolveMediaBlob(media), options.signal));
	if (options.signal?.aborted) throw abortError(parseAbortReason(options.signal.reason));
	const thumbRelPath = await saveSceneThumbnail(media.id, 0, thumbnail);
	if (options.signal?.aborted) throw abortError(parseAbortReason(options.signal.reason));
	const durationSec =
		(media.animationFrameCount ?? 0) > 1 && media.duration > 0 ? media.duration : 3;
	const analysis: SceneAnalysis = {
		schemaVersion: 1,
		detectorVersion: SCENE_BROWSER_DETECTOR_VERSION,
		mediaId: media.id,
		contentHash: media.contentHash,
		sourceFileSize: media.fileSize,
		sourceLastModified: media.fileLastModified,
		method: 'image',
		sampleIntervalSec: 0,
		analyzedAt: Date.now(),
		scenes: [
			{
				id: `${media.id}:0`,
				mediaId: media.id,
				index: 0,
				startSec: 0,
				endSec: durationSec,
				timeSec: 0,
				text: '',
				thumbRelPath
			}
		]
	};
	await saveSceneAnalysis(analysis);
	options.onProgress?.({ stage: 'thumbnails', percent: 100, completed: 1, total: 1 });
	return analysis;
}

export async function analyzeMediaScenes(
	media: MediaMetadata,
	options: AnalyzeSceneOptions = {}
): Promise<SceneAnalysis> {
	if (!isSceneAnalyzableMedia(media)) {
		throw new Error(`Scene analysis does not support ${media.mimeType || 'this media type'}`);
	}
	if (!options.force) {
		const cached = await getSceneAnalysis(media.id);
		if (
			cached &&
			cached.detectorVersion === SCENE_BROWSER_DETECTOR_VERSION &&
			sceneAnalysisMatchesMedia(cached, media)
		) {
			return cached;
		}
	}
	return analyzeFresh(media, options);
}

export async function detectAdaptiveSceneCuts(
	media: MediaMetadata,
	options: Pick<AnalyzeSceneOptions, 'signal' | 'onProgress'> = {}
): Promise<SceneCut[]> {
	if (!isSceneAnalyzableMedia(media) || isImageMedia(media)) {
		throw new Error(
			`Adaptive scene detection does not support ${media.mimeType || 'this media type'}`
		);
	}
	return (await runWorker(media, options.signal, options.onProgress, false)).cuts;
}
