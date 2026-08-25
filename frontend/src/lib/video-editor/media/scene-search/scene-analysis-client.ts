/** Scene analysis client and persistent cache coordinator. */

import { resolveMediaBlob } from '../import.svelte';
import type { MediaMetadata } from '../types';
import {
	getSceneAnalysis,
	saveSceneAnalysis,
	saveSceneThumbnail,
	sceneAnalysisMatchesMedia
} from '../../workspace-fs/scene-analysis';
import type {
	SceneAnalysisWorkerComplete,
	SceneAnalysisWorkerResponse
} from './scene-analysis.worker';
import type { SceneAnalysis, SceneAnalysisProgress } from './types';

export const SCENE_BROWSER_DETECTOR_VERSION = 2;

interface AnalyzeSceneOptions {
	signal?: AbortSignal;
	force?: boolean;
	onProgress?: (progress: SceneAnalysisProgress) => void;
}

/** Parsed abort reason string from `AbortSignal.reason`. */
type AbortReasonText = string;

function parseAbortReason(reason: unknown): AbortReasonText | undefined {
	return typeof reason === 'string' ? reason : undefined;
}

function abortError(reason?: string): DOMException {
	return new DOMException(reason ?? 'Scene analysis cancelled', 'AbortError');
}

async function runWorker(
	media: MediaMetadata,
	signal: AbortSignal | undefined,
	onProgress: AnalyzeSceneOptions['onProgress']
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
			worker.postMessage({ type: 'analyze', requestId, blob, method: 'adaptive' });
		});
	} finally {
		worker.terminate();
	}
}

async function analyzeFresh(
	media: MediaMetadata,
	options: AnalyzeSceneOptions
): Promise<SceneAnalysis> {
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

export async function analyzeMediaScenes(
	media: MediaMetadata,
	options: AnalyzeSceneOptions = {}
): Promise<SceneAnalysis> {
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
