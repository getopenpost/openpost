/** Complete local scene caption and semantic-index pipeline. */

import { getSceneThumbnail, saveSceneAnalysis } from '../../../workspace-fs/scene-analysis';
import { extractDominantColors } from '../dominant-colors';
import type { SceneAnalysis, SceneAnalysisProgress } from '../types';
import { sceneCaptionProvider, SCENE_CAPTION_MODEL_ID } from './caption-provider';
import { clipProvider, CLIP_MODEL_ID } from './clip-provider';
import { buildEmbeddingText } from './context';
import { embeddingsProvider, EMBEDDING_MODEL_ID } from './embeddings-provider';

interface SceneContentAnalysisOptions {
	signal?: AbortSignal;
	onProgress?: (progress: SceneAnalysisProgress) => void;
}

const CLIP_BATCH_SIZE = 8;

function report(
	options: SceneContentAnalysisOptions,
	stage: SceneAnalysisProgress['stage'],
	percent: number,
	completed: number,
	total: number
): void {
	options.onProgress?.({ stage, percent: Math.round(percent), completed, total });
}

async function loadThumbnails(analysis: SceneAnalysis): Promise<Blob[]> {
	const thumbnails = await Promise.all(
		analysis.scenes.map((scene) =>
			scene.thumbRelPath ? getSceneThumbnail(scene.thumbRelPath) : Promise.resolve(null)
		)
	);
	if (thumbnails.some((thumbnail) => !thumbnail)) {
		throw new Error('One or more scene thumbnails are missing');
	}
	// SAFETY: guarded above - every entry is non-null once the `some` check passed, so `Blob[]` is sound.
	return thumbnails as Blob[];
}

async function embedImagesInBatches(
	thumbnails: Blob[],
	options: SceneContentAnalysisOptions
): Promise<Float32Array[]> {
	const vectors: Float32Array[] = [];
	for (let from = 0; from < thumbnails.length; from += CLIP_BATCH_SIZE) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new DOMException('Scene indexing cancelled', 'AbortError');
		}
		const batch = thumbnails.slice(from, from + CLIP_BATCH_SIZE);
		const next = await clipProvider.embedImages(batch, {
			signal: options.signal,
			onProgress(progress) {
				report(options, 'loading-models', progress.percent, from, thumbnails.length);
			}
		});
		vectors.push(...next);
		report(
			options,
			'indexing',
			((from + batch.length) / thumbnails.length) * 100,
			from + batch.length,
			thumbnails.length
		);
	}
	return vectors;
}

export async function analyzeSceneContent(
	analysis: SceneAnalysis,
	options: SceneContentAnalysisOptions = {}
): Promise<SceneAnalysis> {
	const thumbnails = await loadThumbnails(analysis);
	const colors = await Promise.all(thumbnails.map((thumbnail) => extractDominantColors(thumbnail)));

	let captions;
	try {
		captions = await sceneCaptionProvider.captionImages(thumbnails, {
			signal: options.signal,
			onProgress(progress) {
				report(
					options,
					progress.stage === 'loading-model' ? 'loading-models' : 'captioning',
					progress.percent,
					progress.completed,
					progress.total
				);
			}
		});
	} finally {
		// The caption model is the largest model in this path. Release it before
		// loading both embedding models so long projects stay inside GPU limits.
		sceneCaptionProvider.dispose();
	}

	const textInputs = captions.map((caption, index) =>
		buildEmbeddingText({
			caption: {
				text: caption.text,
				timeSec: analysis.scenes[index]?.timeSec ?? 0
			},
			sceneData: caption.sceneData,
			colorPhrase: colors[index]?.phrase
		})
	);
	const textVectors = await embeddingsProvider.embedBatch(textInputs, {
		signal: options.signal,
		onProgress(progress) {
			report(options, 'loading-models', progress.percent, 0, textInputs.length);
		}
	});
	report(options, 'indexing', 45, textVectors.length, textInputs.length + thumbnails.length);

	const imageVectors = await embedImagesInBatches(thumbnails, options);
	const scenes = analysis.scenes.map((scene, index) => ({
		...scene,
		text: captions[index]?.text ?? '',
		sceneData: captions[index]?.sceneData,
		palette: colors[index]?.palette ?? scene.palette,
		embedding: textVectors[index],
		imageEmbedding: imageVectors[index]
	}));
	const complete: SceneAnalysis = {
		...analysis,
		captionModel: SCENE_CAPTION_MODEL_ID,
		textEmbeddingModel: EMBEDDING_MODEL_ID,
		imageEmbeddingModel: CLIP_MODEL_ID,
		analyzedAt: Date.now(),
		scenes
	};
	await saveSceneAnalysis(complete);
	report(options, 'indexing', 100, scenes.length, scenes.length);
	return complete;
}
