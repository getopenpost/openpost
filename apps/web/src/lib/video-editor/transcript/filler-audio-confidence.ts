import type { AudioBufferLike } from '../audio/audio-silence';
import { localAiRuntimeRegistry } from '../local-ai/runtime-registry';
import { decodeAudioRangeForAnalysis } from '../media/silence';
import type { FillerAudioConfidence, FillerRange, FillerRangesByMediaId } from './speech-cleanup';

const CLAP_MODEL_ID = 'Xenova/clap-htsat-unfused';
const CLAP_SAMPLE_RATE = 48_000;
const MIN_AUDIO_WINDOW_SECONDS = 0.35;
const WINDOW_CONTEXT_SECONDS = 0.08;
const MAX_CONCURRENT_SCORES = 2;
const SCORE_CACHE_MAX_ENTRIES = 500;

const FILLER_LABELS = [
	'hesitation sound',
	'person saying um',
	'person saying uh',
	'person hesitating while speaking'
] as const;
const NON_FILLER_LABELS = ['normal speech', 'silence', 'music', 'background noise'] as const;
const CANDIDATE_LABELS = [...FILLER_LABELS, ...NON_FILLER_LABELS];

interface AudioLabelScore {
	label: string;
	score: number;
}

interface PipelineProgress {
	status?: string;
	progress?: number;
	loaded?: number;
	total?: number;
}

interface ZeroShotAudioClassifier {
	(
		audio: Float32Array,
		labels: readonly string[],
		options: { hypothesis_template: string }
	): Promise<AudioLabelScore[]>;
	dispose?: () => Promise<void> | void;
}

interface TransformersModule {
	env: {
		useBrowserCache: boolean;
		allowLocalModels: boolean;
	};
	pipeline(
		task: 'zero-shot-audio-classification',
		modelId: string,
		options: {
			device: 'webgpu' | 'wasm';
			dtype: 'q8';
			progress_callback: (event: PipelineProgress) => void;
		}
	): Promise<ZeroShotAudioClassifier>;
}

export interface FillerAudioConfidenceProgress {
	stage: 'model' | 'scoring';
	progress: number;
}

export interface FillerAudioConfidenceOptions {
	signal?: AbortSignal;
	onProgress?: (event: FillerAudioConfidenceProgress) => void;
}

let classifierPromise: Promise<ZeroShotAudioClassifier> | null = null;
let classifier: ZeroShotAudioClassifier | null = null;
const scoreCache = new Map<string, FillerAudioConfidence>();

function abortError(): DOMException {
	return new DOMException('Filler confidence analysis cancelled', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortError();
}

function cacheKey(mediaId: string, range: FillerRange): string {
	return `${mediaId}:${range.start.toFixed(3)}:${range.end.toFixed(3)}:${range.text}`;
}

function cachedScore(key: string): FillerAudioConfidence | undefined {
	const value = scoreCache.get(key);
	if (!value) return undefined;
	scoreCache.delete(key);
	scoreCache.set(key, value);
	return value;
}

function cacheScore(key: string, value: FillerAudioConfidence): void {
	if (scoreCache.size >= SCORE_CACHE_MAX_ENTRIES) {
		const oldest = scoreCache.keys().next().value;
		if (oldest) scoreCache.delete(oldest);
	}
	scoreCache.set(key, value);
}

function modelProgress(event: PipelineProgress): number {
	if (Number.isFinite(event.progress)) return Math.max(0, Math.min(1, (event.progress ?? 0) / 100));
	if (event.loaded && event.total) return Math.max(0, Math.min(1, event.loaded / event.total));
	return 0;
}

async function loadClassifier(
	onProgress: FillerAudioConfidenceOptions['onProgress']
): Promise<ZeroShotAudioClassifier> {
	if (classifier) return classifier;
	classifierPromise ??= (async () => {
		// SAFETY: the installed Transformers package exposes this documented pipeline contract.
		const transformers = (await import('@huggingface/transformers')) as TransformersModule;
		transformers.env.useBrowserCache = true;
		transformers.env.allowLocalModels = false;
		let reportedProgress = 0;
		const progress_callback = (event: PipelineProgress) => {
			reportedProgress = Math.max(reportedProgress, modelProgress(event));
			onProgress?.({ stage: 'model', progress: reportedProgress });
		};
		try {
			return await transformers.pipeline('zero-shot-audio-classification', CLAP_MODEL_ID, {
				device: 'webgpu',
				dtype: 'q8',
				progress_callback
			});
		} catch {
			return transformers.pipeline('zero-shot-audio-classification', CLAP_MODEL_ID, {
				device: 'wasm',
				dtype: 'q8',
				progress_callback
			});
		}
	})();
	try {
		classifier = await classifierPromise;
		return classifier;
	} catch (error) {
		classifierPromise = null;
		throw error;
	}
}

function audioWindowBounds(range: FillerRange) {
	const midpoint = (range.start + range.end) / 2;
	const halfWindow = Math.max(MIN_AUDIO_WINDOW_SECONDS, range.end - range.start) / 2;
	return {
		start: Math.max(0, midpoint - halfWindow - WINDOW_CONTEXT_SECONDS),
		end: midpoint + halfWindow + WINDOW_CONTEXT_SECONDS
	};
}

function resampleMonoWindow(buffer: AudioBufferLike): Float32Array {
	const source = buffer.getChannelData(0);
	if (buffer.sampleRate === CLAP_SAMPLE_RATE) return source;
	const length = Math.max(1, Math.round((source.length * CLAP_SAMPLE_RATE) / buffer.sampleRate));
	const output = new Float32Array(length);
	const ratio = buffer.sampleRate / CLAP_SAMPLE_RATE;
	for (let index = 0; index < length; index++) {
		const sourceIndex = index * ratio;
		const leftIndex = Math.floor(sourceIndex);
		const rightIndex = Math.min(source.length - 1, leftIndex + 1);
		const mix = sourceIndex - leftIndex;
		const left = source[leftIndex] ?? 0;
		output[index] = left + ((source[rightIndex] ?? left) - left) * mix;
	}
	return output;
}

export function classifyFillerAudioConfidence(
	scores: readonly AudioLabelScore[]
): FillerAudioConfidence {
	const filler = scores
		.filter((entry) => FILLER_LABELS.some((label) => label === entry.label))
		.toSorted((left, right) => right.score - left.score)[0];
	const nonFiller = scores
		.filter((entry) => NON_FILLER_LABELS.some((label) => label === entry.label))
		.toSorted((left, right) => right.score - left.score)[0];
	const fillerScore = filler?.score ?? 0;
	const nonFillerScore = nonFiller?.score ?? 0;
	const margin = fillerScore - nonFillerScore;
	return {
		level:
			fillerScore >= 0.42 && margin >= 0.12
				? 'high'
				: fillerScore >= 0.28 && margin >= 0.02
					? 'medium'
					: 'low',
		fillerScore,
		nonFillerScore,
		label: filler?.label ?? 'hesitation sound'
	};
}

async function scoreRange(
	model: ZeroShotAudioClassifier,
	loadBuffer: () => Promise<AudioBufferLike>,
	range: FillerRange
): Promise<FillerRange> {
	const mediaId = range.mediaId;
	const key = cacheKey(mediaId, range);
	const cached = cachedScore(key);
	if (cached) return { ...range, audioConfidence: cached };
	const buffer = await loadBuffer();
	const scores = await model(resampleMonoWindow(buffer), CANDIDATE_LABELS, {
		hypothesis_template: 'This audio contains {}.'
	});
	const confidence = classifyFillerAudioConfidence(scores);
	cacheScore(key, confidence);
	return { ...range, audioConfidence: confidence };
}

async function scoreWithLimit(
	ranges: readonly FillerRange[],
	worker: (range: FillerRange) => Promise<FillerRange>
): Promise<FillerRange[]> {
	const results: FillerRange[] = [];
	let next = 0;
	async function run(): Promise<void> {
		while (next < ranges.length) {
			const index = next++;
			results[index] = await worker(ranges[index]!);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_SCORES, ranges.length) }, () => run())
	);
	return results;
}

export async function scoreFillerRangesWithAudioConfidence(
	rangesByMediaId: FillerRangesByMediaId,
	options: FillerAudioConfidenceOptions = {}
): Promise<FillerRangesByMediaId> {
	const entries = Object.entries(rangesByMediaId);
	const total = entries.reduce((count, [, ranges]) => count + ranges.length, 0);
	if (total === 0) return {};
	throwIfAborted(options.signal);
	const model = await loadClassifier(options.onProgress);
	let completed = 0;
	const output: FillerRangesByMediaId = {};
	for (const [mediaId, ranges] of entries) {
		throwIfAborted(options.signal);
		try {
			output[mediaId] = await scoreWithLimit(ranges, async (range) => {
				throwIfAborted(options.signal);
				const window = audioWindowBounds(range);
				const scored = await scoreRange(
					model,
					() => decodeAudioRangeForAnalysis(mediaId, window.start, window.end, options.signal),
					range
				);
				completed += 1;
				options.onProgress?.({ stage: 'scoring', progress: completed / total });
				return scored;
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			output[mediaId] = ranges.map((range) => ({
				...range,
				audioConfidence: {
					level: 'unknown',
					fillerScore: 0,
					nonFillerScore: 0,
					label: 'unavailable audio'
				}
			}));
			completed += ranges.length;
			options.onProgress?.({ stage: 'scoring', progress: completed / total });
		}
	}
	return output;
}

export async function unloadFillerAudioConfidenceModel(): Promise<void> {
	const active = classifier;
	classifier = null;
	classifierPromise = null;
	scoreCache.clear();
	await active?.dispose?.();
}

localAiRuntimeRegistry.register({
	id: 'filler-audio-confidence',
	label: 'Filler audio confidence',
	isLoaded: () => classifier !== null,
	unload: unloadFillerAudioConfidenceModel
});
