// Ported from FreeCut (MIT), adapted to OpenPost's workspace store.

import type { PaletteEntry } from './dominant-colors';

export interface SceneCaptionData {
	caption?: string;
	shotType?: string;
	subjects?: string[];
	action?: string;
	setting?: string;
	lighting?: string;
	timeOfDay?: string;
	weather?: string;
}

export interface MediaScene {
	/** Stable id across reloads while scene order is unchanged. */
	id: string;
	mediaId: string;
	index: number;
	startSec: number;
	endSec: number;
	/** Representative thumbnail and seek time. */
	timeSec: number;
	/** Local model caption. Empty until semantic analysis completes. */
	text: string;
	sceneData?: SceneCaptionData;
	thumbRelPath?: string;
	palette?: PaletteEntry[];
	/** Unit-length all-MiniLM vector. Persisted in a packed binary file. */
	embedding?: Float32Array;
	/** Unit-length CLIP image vector. Persisted in a packed binary file. */
	imageEmbedding?: Float32Array;
}

export interface SceneAnalysis {
	schemaVersion: 1;
	detectorVersion: number;
	mediaId: string;
	contentHash?: string;
	sourceFileSize: number;
	sourceLastModified?: number;
	method: 'histogram' | 'adaptive' | 'image';
	sampleIntervalSec: number;
	captionModel?: string;
	textEmbeddingModel?: string;
	imageEmbeddingModel?: string;
	analyzedAt: number;
	scenes: MediaScene[];
}

export interface SceneAnalysisProgress {
	stage: 'detecting' | 'thumbnails' | 'loading-models' | 'captioning' | 'indexing';
	percent: number;
	completed: number;
	total: number;
}
