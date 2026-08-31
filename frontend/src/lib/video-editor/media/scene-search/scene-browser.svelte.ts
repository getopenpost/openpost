/** Reactive Scene Browser state. Ported from FreeCut (MIT), adapted to Svelte. */

import { mediaPool } from '../pool.svelte';
import type { MediaMetadata } from '../types';
import { getSceneAnalysis } from '../../workspace-fs/scene-analysis';
import { analyzeMediaScenes, isSceneAnalyzableMedia } from './scene-analysis-client';
import { parseColorQuery } from './color-boost';
import { rankScenes, type RankableScene, type ScoredScene } from './rank';
import { semanticRank } from './semantic-rank';
import type { MediaScene, SceneAnalysis, SceneAnalysisProgress } from './types';
import { analyzeSceneContent } from './ai/analyze-scenes';
import { embeddingsProvider } from './ai/embeddings-provider';
import { clipProvider } from './ai/clip-provider';
import type { PaletteEntry } from './dominant-colors';
import { mediaTaskId, mediaTasks } from '../media-tasks.svelte';

export type SceneBrowserViewMode = 'grid' | 'list';
export type SceneBrowserSortMode = 'relevance' | 'time' | 'name';

interface SceneBrowserState {
	query: string;
	scope: string | null;
	viewMode: SceneBrowserViewMode;
	sortMode: SceneBrowserSortMode;
	analyses: Record<string, SceneAnalysis>;
	progress: Record<string, SceneAnalysisProgress>;
	errors: Record<string, string>;
	queryEmbedding: Float32Array | null;
	queryImageEmbedding: Float32Array | null;
	querying: boolean;
	colorMode: boolean;
	referencePalette: PaletteEntry[] | null;
}

const state = $state<SceneBrowserState>({
	query: '',
	scope: null,
	viewMode: 'grid',
	sortMode: 'time',
	analyses: {},
	progress: {},
	errors: {},
	queryEmbedding: null,
	queryImageEmbedding: null,
	querying: false,
	colorMode: false,
	referencePalette: null
});

const loadPromises = new Map<string, Promise<void>>();
const analysisControllers = new Map<string, AbortController>();
let queryGeneration = 0;
let stateGeneration = 0;

function mediaName(mediaId: string): string {
	return mediaPool.get(mediaId)?.fileName ?? mediaId;
}

function toRankable(scene: MediaScene): RankableScene {
	return {
		id: scene.id,
		mediaId: scene.mediaId,
		mediaFileName: mediaName(scene.mediaId),
		timeSec: scene.timeSec,
		text: scene.text,
		thumbRelPath: scene.thumbRelPath,
		palette: scene.palette
	};
}

function sortScenes(scenes: ScoredScene[], mode: SceneBrowserSortMode): ScoredScene[] {
	if (mode === 'relevance') return scenes;
	return scenes.toSorted((left, right) => {
		if (mode === 'name' && left.mediaFileName !== right.mediaFileName) {
			return left.mediaFileName.localeCompare(right.mediaFileName);
		}
		if (left.mediaId !== right.mediaId)
			return left.mediaFileName.localeCompare(right.mediaFileName);
		return left.timeSec - right.timeSec;
	});
}

function hasCompleteSemanticIndex(analysis: SceneAnalysis): boolean {
	return Boolean(
		analysis.captionModel &&
		analysis.textEmbeddingModel &&
		analysis.imageEmbeddingModel &&
		analysis.scenes.every((scene) => scene.text && scene.embedding && scene.imageEmbedding)
	);
}

function mergeRanked(primary: ScoredScene[], keyword: ScoredScene[]): ScoredScene[] {
	const merged = new Map(primary.map((scene) => [scene.id, scene]));
	for (const scene of keyword) {
		const existing = merged.get(scene.id);
		if (!existing || scene.score > existing.score) merged.set(scene.id, scene);
	}
	return [...merged.values()].toSorted((left, right) => right.score - left.score);
}

export const sceneBrowser = {
	get query(): string {
		return state.query;
	},
	set query(value: string) {
		state.query = value;
		if (value.trim()) state.referencePalette = null;
	},
	get scope(): string | null {
		return state.scope;
	},
	set scope(value: string | null) {
		state.scope = value;
	},
	get viewMode(): SceneBrowserViewMode {
		return state.viewMode;
	},
	set viewMode(value: SceneBrowserViewMode) {
		state.viewMode = value;
	},
	get sortMode(): SceneBrowserSortMode {
		return state.sortMode;
	},
	set sortMode(value: SceneBrowserSortMode) {
		state.sortMode = value;
	},
	get analyzedMediaIds(): string[] {
		return Object.keys(state.analyses);
	},
	get analyzingMediaIds(): string[] {
		return Object.keys(state.progress);
	},
	get querying(): boolean {
		return state.querying;
	},
	get colorMode(): boolean {
		return state.colorMode;
	},
	set colorMode(value: boolean) {
		state.colorMode = value;
	},
	get referencePalette(): PaletteEntry[] | null {
		return state.referencePalette;
	},
	set referencePalette(value: PaletteEntry[] | null) {
		state.referencePalette = value;
		if (value) state.query = '';
	},
	get allPalettes(): PaletteEntry[][] {
		return Object.values(state.analyses).flatMap((analysis) =>
			analysis.scenes.flatMap((scene) => (scene.palette ? [scene.palette] : []))
		);
	},
	analysis(mediaId: string): SceneAnalysis | undefined {
		return state.analyses[mediaId];
	},
	progress(mediaId: string): SceneAnalysisProgress | undefined {
		return state.progress[mediaId];
	},
	error(mediaId: string): string | undefined {
		return state.errors[mediaId];
	},
	get totalScenes(): number {
		return Object.values(state.analyses).reduce((sum, analysis) => sum + analysis.scenes.length, 0);
	},
	getScene(sceneId: string): MediaScene | undefined {
		const separator = sceneId.lastIndexOf(':');
		if (separator < 0) return undefined;
		const mediaId = sceneId.slice(0, separator);
		return state.analyses[mediaId]?.scenes.find((scene) => scene.id === sceneId);
	},

	reset(): void {
		for (const controller of analysisControllers.values()) controller.abort();
		analysisControllers.clear();
		loadPromises.clear();
		queryGeneration += 1;
		stateGeneration += 1;
		state.query = '';
		state.scope = null;
		state.analyses = {};
		state.progress = {};
		state.errors = {};
		state.queryEmbedding = null;
		state.queryImageEmbedding = null;
		state.querying = false;
		state.colorMode = false;
		state.referencePalette = null;
	},

	__setAnalysisForTesting(analysis: SceneAnalysis): void {
		state.analyses[analysis.mediaId] = analysis;
	},

	async load(mediaId: string): Promise<void> {
		if (state.analyses[mediaId] || loadPromises.has(mediaId)) {
			return loadPromises.get(mediaId);
		}
		const generation = stateGeneration;
		const promise = getSceneAnalysis(mediaId)
			.then((analysis) => {
				if (generation === stateGeneration && analysis && mediaPool.get(mediaId)) {
					state.analyses[mediaId] = analysis;
				}
			})
			.finally(() => {
				if (loadPromises.get(mediaId) === promise) loadPromises.delete(mediaId);
			});
		loadPromises.set(mediaId, promise);
		return promise;
	},

	async loadAll(): Promise<void> {
		await Promise.all(mediaPool.mediaList.map((media) => this.load(media.id)));
	},

	async analyze(media: MediaMetadata, force = false): Promise<SceneAnalysis> {
		const generation = stateGeneration;
		const controller = new AbortController();
		analysisControllers.get(media.id)?.abort();
		analysisControllers.set(media.id, controller);
		const taskId = mediaTaskId('scene-analysis', media.id);
		const taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'scene-analysis',
			mediaId: media.id,
			label: media.fileName,
			stage: 'detecting',
			progress: 0,
			onCancel: () => controller.abort()
		});
		delete state.errors[media.id];
		state.progress[media.id] = {
			stage: 'detecting',
			percent: 0,
			completed: 0,
			total: 0
		};
		try {
			const detected = await analyzeMediaScenes(media, {
				force,
				signal: controller.signal,
				onProgress(progress) {
					state.progress[media.id] = progress;
					mediaTasks.update(
						taskId,
						{
							stage: progress.stage,
							progress: progress.percent / 100,
							completed: progress.completed,
							total: progress.total
						},
						taskRevision
					);
				}
			});
			if (generation !== stateGeneration) {
				throw new DOMException('Scene analysis belongs to an inactive project', 'AbortError');
			}
			state.analyses[media.id] = detected;
			const analysis = await analyzeSceneContent(detected, {
				signal: controller.signal,
				onProgress(progress) {
					state.progress[media.id] = progress;
					mediaTasks.update(
						taskId,
						{
							stage: progress.stage,
							progress: progress.percent / 100,
							completed: progress.completed,
							total: progress.total
						},
						taskRevision
					);
				}
			});
			if (generation !== stateGeneration) {
				throw new DOMException('Scene analysis belongs to an inactive project', 'AbortError');
			}
			state.analyses[media.id] = analysis;
			return analysis;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				state.errors[media.id] = error instanceof Error ? error.message : String(error);
			}
			throw error;
		} finally {
			mediaTasks.finish(taskId, taskRevision);
			if (analysisControllers.get(media.id) === controller) {
				delete state.progress[media.id];
				analysisControllers.delete(media.id);
			}
		}
	},

	cancel(mediaId: string): void {
		analysisControllers.get(mediaId)?.abort();
		embeddingsProvider.dispose();
		clipProvider.dispose();
	},

	forget(mediaId: string): void {
		analysisControllers.get(mediaId)?.abort();
		analysisControllers.delete(mediaId);
		loadPromises.delete(mediaId);
		delete state.analyses[mediaId];
		delete state.progress[mediaId];
		delete state.errors[mediaId];
		if (state.scope === mediaId) state.scope = null;
	},

	async prepareSemanticQuery(query: string): Promise<void> {
		const trimmed = query.trim();
		const generation = ++queryGeneration;
		if (!trimmed || parseColorQuery(trimmed).paletteOnly) {
			state.queryEmbedding = null;
			state.queryImageEmbedding = null;
			state.querying = false;
			return;
		}
		const hasSemanticIndex = Object.values(state.analyses).some((analysis) =>
			analysis.scenes.some((scene) => scene.embedding || scene.imageEmbedding)
		);
		if (!hasSemanticIndex) {
			state.queryEmbedding = null;
			state.queryImageEmbedding = null;
			state.querying = false;
			return;
		}
		state.querying = true;
		try {
			const [text, image] = await Promise.all([
				embeddingsProvider.embed(trimmed),
				clipProvider.embedQueryForImages(trimmed)
			]);
			if (generation !== queryGeneration) return;
			state.queryEmbedding = text;
			state.queryImageEmbedding = image;
		} catch {
			if (generation === queryGeneration) {
				state.queryEmbedding = null;
				state.queryImageEmbedding = null;
			}
		} finally {
			if (generation === queryGeneration) state.querying = false;
		}
	},

	async analyzeBatch(force = false): Promise<void> {
		const media = mediaPool.mediaList.filter(isSceneAnalyzableMedia);
		for (const item of media) {
			if (!force && state.analyses[item.id] && hasCompleteSemanticIndex(state.analyses[item.id]!)) {
				continue;
			}
			await this.analyze(item, force);
		}
	},

	rankedScenes(): ScoredScene[] {
		const source = Object.values(state.analyses)
			.filter((analysis) => !state.scope || analysis.mediaId === state.scope)
			.flatMap((analysis) => analysis.scenes)
			.map(toRankable);
		const query = state.query.trim();
		let ranked: ScoredScene[];
		const colorQuery = parseColorQuery(query);
		if (state.referencePalette) {
			const palettes = new Map(
				source.filter((scene) => scene.palette).map((scene) => [scene.id, scene.palette!])
			);
			ranked = semanticRank(new Float32Array(), source, new Map(), {
				palettes,
				referencePalette: state.referencePalette
			});
		} else if (query && colorQuery.paletteOnly) {
			const palettes = new Map(
				source.filter((scene) => scene.palette).map((scene) => [scene.id, scene.palette!])
			);
			ranked = semanticRank(new Float32Array(), source, new Map(), { query, palettes });
		} else if (query && state.queryEmbedding) {
			const textEmbeddings = new Map<string, Float32Array>();
			const imageEmbeddings = new Map<string, Float32Array>();
			const palettes = new Map<string, NonNullable<RankableScene['palette']>>();
			for (const analysis of Object.values(state.analyses)) {
				for (const scene of analysis.scenes) {
					if (scene.embedding) textEmbeddings.set(scene.id, scene.embedding);
					if (scene.imageEmbedding) imageEmbeddings.set(scene.id, scene.imageEmbedding);
					if (scene.palette) palettes.set(scene.id, scene.palette);
				}
			}
			const semantic = semanticRank(state.queryEmbedding, source, textEmbeddings, {
				query,
				queryImageEmbedding: state.queryImageEmbedding,
				imageEmbeddings,
				palettes
			});
			ranked = mergeRanked(semantic, rankScenes(query, source));
		} else {
			ranked = rankScenes(query, source);
		}
		const hasActiveRanking = Boolean(query || state.referencePalette);
		return sortScenes(
			ranked,
			hasActiveRanking ? state.sortMode : state.sortMode === 'relevance' ? 'time' : state.sortMode
		);
	}
};
