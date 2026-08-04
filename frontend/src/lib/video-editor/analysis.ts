import {
	derivePrimarySequence,
	fillerCandidates,
	isPrimarySequenceClip,
	projectDurationUS,
	silenceSuggestions,
	type CaptionCue,
	type CaptionWord,
	type FillerCandidate,
	type SpeechRange,
	type VideoProjectDocumentV1,
	type VideoSource
} from '@openpost/video-project';
import { sha256 } from '@noble/hashes/sha256';
import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	Input,
	type WrappedAudioBuffer
} from 'mediabunny';
import type { VideoEditorConfig } from './api';
import { ensureVideoEditorModel, type ModelDownloadProgress } from './model-manager';
import { openVideoProjectSource } from './source-access';
import { listAnalysisResults, saveAnalysisResult } from './storage';

const SAMPLE_RATE = 16_000;
const TRANSCRIPTION_WINDOW_SECONDS = 25;
const TRANSCRIPTION_OVERLAP_SECONDS = 2;
const VAD_WINDOW_SECONDS = 20;

interface SourceAudio {
	input: Input;
	sink: AudioBufferSink;
}

interface TranscriptWorkerChunk {
	text?: string;
	timestamp?: [number | null, number | null];
	confidence?: number;
}

interface TranscriptWorkerOutput {
	text?: string;
	chunks?: TranscriptWorkerChunk[];
}

interface VADWorkerRegion {
	start_sample: number;
	end_sample: number;
}

export interface TranscriptAnalysis {
	language: string;
	words: CaptionWord[];
	cues: CaptionCue[];
	fillers: FillerCandidate[];
	device: 'webgpu' | 'wasm';
	model_version: string;
}

export interface SilenceAnalysis {
	speech: SpeechRange[];
	silences: ReturnType<typeof silenceSuggestions>;
	model_version: string;
}

export interface LoudnessAdjustment {
	item_id: string;
	kind: 'primary' | 'audio';
	measured_lufs: number;
	gain_db: number;
}

export interface LocalAnalysisProgress {
	stage: 'model' | 'decoding' | 'transcribing' | 'vad';
	fraction: number;
	detail?: string;
	model?: ModelDownloadProgress;
}

export async function transcribeVideoProject(
	projectID: string,
	project: VideoProjectDocumentV1,
	config: VideoEditorConfig,
	options: {
		language?: string;
		onProgress?: (progress: LocalAnalysisProgress) => void;
		signal?: AbortSignal;
	} = {}
): Promise<TranscriptAnalysis> {
	const requestedLanguage = options.language ?? 'auto';
	const model = config.model_manifest?.find((item) => item.id === 'whisper-tiny-multilingual');
	if (!model) throw new Error('The local transcription model is not configured.');
	const sourceHash = sourceFingerprint(project);
	const timelineHash = timelineFingerprint(project);
	const algorithmVersion = `transformers-whisper-tiny:${model.version}`;
	const cached = await cachedAnalysisResult<TranscriptAnalysis>(
		projectID,
		'transcript',
		sourceHash,
		timelineHash,
		algorithmVersion,
		{ language: requestedLanguage }
	);
	if (cached) {
		options.onProgress?.({ stage: 'transcribing', fraction: 1, detail: 'Cached result' });
		return cached;
	}
	const modelInfo = await ensureVideoEditorModel(
		config,
		'whisper-tiny-multilingual',
		(model) => options.onProgress?.({ stage: 'model', fraction: model.fraction, model }),
		options.signal
	);
	const worker = new AnalysisWorker();
	const sources = new Map<string, SourceAudio>();
	const words: CaptionWord[] = [];
	let device: 'webgpu' | 'wasm' = 'gpu' in navigator ? 'webgpu' : 'wasm';
	const clips = derivePrimarySequence(project);
	try {
		for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
			options.signal?.throwIfAborted();
			const derived = clips[clipIndex]!;
			const clip = project.primary_sequence[derived.index]!;
			if (!isPrimarySequenceClip(clip)) continue;
			const source = project.sources[clip.source_id];
			if (!source || source.kind === 'image') continue;
			const audio = await sourceAudio(projectID, source, sources, options.signal);
			if (!audio) continue;
			const sourceStart = clip.source_in_us / 1_000_000;
			const sourceEnd = clip.source_out_us / 1_000_000;
			const step = TRANSCRIPTION_WINDOW_SECONDS - TRANSCRIPTION_OVERLAP_SECONDS;
			for (let windowStart = sourceStart; windowStart < sourceEnd; windowStart += step) {
				options.signal?.throwIfAborted();
				const windowEnd = Math.min(sourceEnd, windowStart + TRANSCRIPTION_WINDOW_SECONDS);
				options.onProgress?.({
					stage: 'decoding',
					fraction:
						(clipIndex + (windowStart - sourceStart) / (sourceEnd - sourceStart)) / clips.length,
					detail: source.original_name
				});
				const pcm = await extractMonoPCM(audio.sink, windowStart, windowEnd, options.signal);
				const response = await worker.request<{
					output: TranscriptWorkerOutput;
					fallback?: boolean;
				}>(
					{
						type: 'transcribe',
						audio: pcm,
						model_base_url: modelInfo.baseURL,
						model_path: modelInfo.model.base_path,
						device,
						language: requestedLanguage
					},
					[pcm.buffer],
					options.signal,
					(message) => {
						if (message.type === 'device-fallback') device = 'wasm';
						options.onProgress?.({
							stage: 'transcribing',
							fraction:
								(clipIndex + (windowStart - sourceStart) / (sourceEnd - sourceStart)) /
								clips.length,
							detail: source.original_name
						});
					}
				);
				const output = response.output;
				for (const chunk of output.chunks ?? []) {
					const startSeconds = chunk.timestamp?.[0];
					const endSeconds = chunk.timestamp?.[1];
					const text = chunk.text?.trim();
					if (startSeconds === null || startSeconds === undefined || !text) continue;
					const safeEnd = endSeconds ?? Math.min(windowEnd - windowStart, startSeconds + 0.8);
					const sourceWordStart = windowStart + startSeconds;
					const sourceWordEnd = windowStart + safeEnd;
					if (sourceWordStart >= sourceEnd) continue;
					const startUS =
						derived.timeline_start_us +
						Math.round(((sourceWordStart - sourceStart) * 1_000_000) / clip.speed);
					const endUS =
						derived.timeline_start_us +
						Math.round(
							((Math.min(sourceEnd, sourceWordEnd) - sourceStart) * 1_000_000) / clip.speed
						);
					if (
						words.some(
							(word) =>
								normalizeToken(word.text) === normalizeToken(text) &&
								Math.abs(word.start_us - startUS) < 180_000
						)
					) {
						continue;
					}
					words.push({
						text,
						start_us: Math.max(derived.timeline_start_us, startUS),
						end_us: Math.min(derived.timeline_end_us, Math.max(startUS + 1, endUS)),
						...(Number.isFinite(chunk.confidence) ? { confidence: chunk.confidence } : {})
					});
				}
			}
		}
	} finally {
		worker.close();
		for (const source of sources.values()) source.input.dispose();
	}
	words.sort((left, right) => left.start_us - right.start_us);
	const language = requestedLanguage !== 'auto' ? requestedLanguage : 'und';
	const result: TranscriptAnalysis = {
		language,
		words,
		cues: captionCues(words),
		fillers: fillerCandidates(words, language),
		device,
		model_version: modelInfo.model.version
	};
	await saveAnalysisResult({
		id: crypto.randomUUID(),
		project_id: projectID,
		source_id: 'timeline',
		source_hash: sourceHash,
		timeline_fingerprint: timelineHash,
		kind: 'transcript',
		algorithm_version: algorithmVersion,
		settings: { language: requestedLanguage },
		result,
		review_status: 'unreviewed',
		created_at: new Date().toISOString()
	});
	return result;
}

export async function detectVideoProjectSilence(
	projectID: string,
	project: VideoProjectDocumentV1,
	config: VideoEditorConfig,
	options: {
		onProgress?: (progress: LocalAnalysisProgress) => void;
		signal?: AbortSignal;
	} = {}
): Promise<SilenceAnalysis> {
	const model = config.model_manifest?.find((item) => item.id === 'silero-vad');
	if (!model) throw new Error('The local voice activity model is not configured.');
	const sourceHash = sourceFingerprint(project);
	const timelineHash = timelineFingerprint(project);
	const algorithmVersion = `silero-vad:${model.version}`;
	const settings = { min_silence_us: 350_000, padding_us: 120_000 };
	const cached = await cachedAnalysisResult<SilenceAnalysis>(
		projectID,
		'silence',
		sourceHash,
		timelineHash,
		algorithmVersion,
		settings
	);
	if (cached) {
		options.onProgress?.({ stage: 'vad', fraction: 1, detail: 'Cached result' });
		return cached;
	}
	const modelInfo = await ensureVideoEditorModel(
		config,
		'silero-vad',
		(model) => options.onProgress?.({ stage: 'model', fraction: model.fraction, model }),
		options.signal
	);
	const worker = new AnalysisWorker();
	const sources = new Map<string, SourceAudio>();
	const speech: SpeechRange[] = [];
	const clips = derivePrimarySequence(project);
	try {
		for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
			const derived = clips[clipIndex]!;
			const clip = project.primary_sequence[derived.index]!;
			if (!isPrimarySequenceClip(clip)) continue;
			const source = project.sources[clip.source_id];
			if (!source || source.kind === 'image') continue;
			const audio = await sourceAudio(projectID, source, sources, options.signal);
			if (!audio) continue;
			await worker.request(
				{ type: 'vad-start', model_url: `${modelInfo.baseURL}/${modelInfo.model.path}` },
				[],
				options.signal
			);
			const sourceStart = clip.source_in_us / 1_000_000;
			const sourceEnd = clip.source_out_us / 1_000_000;
			for (
				let windowStart = sourceStart;
				windowStart < sourceEnd;
				windowStart += VAD_WINDOW_SECONDS
			) {
				options.signal?.throwIfAborted();
				const windowEnd = Math.min(sourceEnd, windowStart + VAD_WINDOW_SECONDS);
				const pcm = await extractMonoPCM(audio.sink, windowStart, windowEnd, options.signal);
				await worker.request({ type: 'vad-chunk', audio: pcm }, [pcm.buffer], options.signal);
				options.onProgress?.({
					stage: 'vad',
					fraction:
						(clipIndex + (windowEnd - sourceStart) / (sourceEnd - sourceStart)) / clips.length,
					detail: source.original_name
				});
			}
			const response = await worker.request<{ regions: VADWorkerRegion[] }>(
				{ type: 'vad-end' },
				[],
				options.signal
			);
			for (const region of response.regions) {
				speech.push({
					start_us:
						derived.timeline_start_us +
						Math.round((region.start_sample * 1_000_000) / SAMPLE_RATE / clip.speed),
					end_us: Math.min(
						derived.timeline_end_us,
						derived.timeline_start_us +
							Math.round((region.end_sample * 1_000_000) / SAMPLE_RATE / clip.speed)
					)
				});
			}
		}
	} finally {
		worker.close();
		for (const source of sources.values()) source.input.dispose();
	}
	const result: SilenceAnalysis = {
		speech,
		silences: silenceSuggestions(speech, projectDurationUS(project)),
		model_version: modelInfo.model.version
	};
	await saveAnalysisResult({
		id: crypto.randomUUID(),
		project_id: projectID,
		source_id: 'timeline',
		source_hash: sourceHash,
		timeline_fingerprint: timelineHash,
		kind: 'silence',
		algorithm_version: algorithmVersion,
		settings,
		result,
		review_status: 'unreviewed',
		created_at: new Date().toISOString()
	});
	return result;
}

export async function measureVideoProjectLoudness(
	project: VideoProjectDocumentV1,
	options: {
		projectID?: string;
		signal?: AbortSignal;
		onProgress?: (progress: number) => void;
		targetLUFS?: number;
	} = {}
): Promise<LoudnessAdjustment[]> {
	const primarySegments = derivePrimarySequence(project)
		.flatMap((timing) => {
			const clip = project.primary_sequence[timing.index]!;
			if (!isPrimarySequenceClip(clip)) return [];
			return [
				{
					id: clip.id,
					kind: 'primary' as const,
					clip,
					source: project.sources[clip.source_id],
					sourceStartUS: clip.source_in_us,
					sourceEndUS: clip.source_out_us
				}
			];
		})
		.filter(
			(item) =>
				item.clip.mode === 'source' &&
				!item.clip.audio.muted &&
				item.source &&
				(item.source.kind === 'video' ||
					item.source.kind === 'audio' ||
					item.source.kind.startsWith('recording-'))
		);
	const audioSegments = project.audio_tracks.flatMap((track) =>
		track.muted
			? []
			: track.items
					.filter((item) => !item.muted && project.sources[item.source_id])
					.map((item) => ({
						id: item.id,
						kind: 'audio' as const,
						clip: item,
						source: project.sources[item.source_id]!,
						sourceStartUS: item.source_in_us,
						sourceEndUS: item.source_in_us + Math.round(item.duration_us * item.speed)
					}))
	);
	const segments = [...primarySegments, ...audioSegments];
	const sources = new Map<string, SourceAudio>();
	const adjustments: LoudnessAdjustment[] = [];
	try {
		for (let clipIndex = 0; clipIndex < segments.length; clipIndex += 1) {
			options.signal?.throwIfAborted();
			const segment = segments[clipIndex]!;
			const audio = await sourceAudio(options.projectID, segment.source, sources, options.signal);
			if (!audio) continue;
			const blockEnergies: number[] = [];
			let peak = 0;
			const windowSeconds = 20;
			const sourceStart = segment.sourceStartUS / 1_000_000;
			const sourceEnd = segment.sourceEndUS / 1_000_000;
			for (let windowStart = sourceStart; windowStart < sourceEnd; windowStart += windowSeconds) {
				options.signal?.throwIfAborted();
				const windowEnd = Math.min(sourceEnd, windowStart + windowSeconds);
				const pcm = await extractMonoPCM(audio.sink, windowStart, windowEnd, options.signal);
				const blockSize = Math.max(1, Math.round(SAMPLE_RATE * 0.4));
				for (let offset = 0; offset < pcm.length; offset += blockSize) {
					const end = Math.min(pcm.length, offset + blockSize);
					let energy = 0;
					for (let index = offset; index < end; index += 1) {
						const sample = pcm[index] ?? 0;
						energy += sample * sample;
						peak = Math.max(peak, Math.abs(sample));
					}
					blockEnergies.push(energy / Math.max(1, end - offset));
				}
				options.onProgress?.(
					(clipIndex + (windowEnd - sourceStart) / Math.max(0.001, sourceEnd - sourceStart)) /
						Math.max(1, segments.length)
				);
			}
			const measurement = integratedLoudness(blockEnergies);
			if (!Number.isFinite(measurement)) continue;
			adjustments.push({
				item_id: segment.id,
				kind: segment.kind,
				measured_lufs: measurement,
				gain_db: loudnessGain(measurement, peak, options.targetLUFS ?? -14)
			});
		}
	} finally {
		for (const source of sources.values()) source.input.dispose();
	}
	return adjustments;
}

export function integratedLoudness(blockEnergies: number[]): number {
	const audible = blockEnergies.filter((energy) => energy > 0 && energyToLUFS(energy) > -70);
	if (audible.length === 0) return Number.NEGATIVE_INFINITY;
	const preliminary = energyToLUFS(mean(audible));
	const relativelyGated = audible.filter((energy) => energyToLUFS(energy) >= preliminary - 10);
	return energyToLUFS(mean(relativelyGated.length > 0 ? relativelyGated : audible));
}

export function loudnessGain(measuredLUFS: number, samplePeak: number, targetLUFS = -14): number {
	const desired = targetLUFS - measuredLUFS;
	const peakLimit = samplePeak > 0 ? 20 * Math.log10(Math.pow(10, -1 / 20) / samplePeak) : 12;
	return Math.max(-60, Math.min(12, desired, peakLimit));
}

function energyToLUFS(energy: number): number {
	return -0.691 + 10 * Math.log10(Math.max(Number.EPSILON, energy));
}

function mean(values: number[]): number {
	return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

async function sourceAudio(
	projectID: string | undefined,
	source: VideoSource,
	cache: Map<string, SourceAudio>,
	signal?: AbortSignal
): Promise<SourceAudio | null> {
	const existing = cache.get(source.id);
	if (existing) return existing;
	const blob = await openVideoProjectSource(projectID, source, signal);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	const track = await input.getPrimaryAudioTrack();
	if (!track || !(await track.canDecode())) {
		input.dispose();
		return null;
	}
	const result = { input, sink: new AudioBufferSink(track) };
	cache.set(source.id, result);
	return result;
}

async function extractMonoPCM(
	sink: AudioBufferSink,
	startSeconds: number,
	endSeconds: number,
	signal?: AbortSignal
): Promise<Float32Array> {
	const buffers: WrappedAudioBuffer[] = [];
	for await (const wrapped of sink.buffers(Math.max(0, startSeconds - 0.05), endSeconds + 0.05)) {
		signal?.throwIfAborted();
		buffers.push(wrapped);
	}
	const result = new Float32Array(
		Math.max(1, Math.ceil((endSeconds - startSeconds) * SAMPLE_RATE))
	);
	let bufferIndex = 0;
	for (let index = 0; index < result.length; index += 1) {
		const timestamp = startSeconds + index / SAMPLE_RATE;
		while (
			bufferIndex < buffers.length - 1 &&
			timestamp >= buffers[bufferIndex]!.timestamp + buffers[bufferIndex]!.duration
		) {
			bufferIndex += 1;
		}
		const wrapped = buffers[bufferIndex];
		if (
			!wrapped ||
			timestamp < wrapped.timestamp ||
			timestamp >= wrapped.timestamp + wrapped.duration
		) {
			continue;
		}
		const sourceIndex = Math.min(
			wrapped.buffer.length - 1,
			Math.max(0, Math.round((timestamp - wrapped.timestamp) * wrapped.buffer.sampleRate))
		);
		let sample = 0;
		for (let channel = 0; channel < wrapped.buffer.numberOfChannels; channel += 1) {
			sample += wrapped.buffer.getChannelData(channel)[sourceIndex] ?? 0;
		}
		result[index] = sample / Math.max(1, wrapped.buffer.numberOfChannels);
	}
	return result;
}

function captionCues(words: CaptionWord[]): CaptionCue[] {
	const cues: CaptionCue[] = [];
	let group: CaptionWord[] = [];
	for (const word of words) {
		const currentText = [...group, word].map((item) => item.text).join(' ');
		const gap = group.length ? word.start_us - group.at(-1)!.end_us : 0;
		if (group.length >= 7 || currentText.length > 44 || gap > 700_000) {
			if (group.length) cues.push(captionCue(group));
			group = [];
		}
		group.push(word);
		if (/[.!?…]$/u.test(word.text)) {
			cues.push(captionCue(group));
			group = [];
		}
	}
	if (group.length) cues.push(captionCue(group));
	return cues;
}

function captionCue(words: CaptionWord[]): CaptionCue {
	return {
		id: crypto.randomUUID(),
		start_us: words[0]!.start_us,
		end_us: words.at(-1)!.end_us,
		text: words.map((word) => word.text).join(' '),
		words: words.map((word) => ({ ...word })),
		review_required: words.some((word) => (word.confidence ?? 1) < 0.6)
	};
}

function sourceFingerprint(project: VideoProjectDocumentV1): string {
	return toHex(
		sha256(
			JSON.stringify(
				Object.values(project.sources).map((source) => [
					source.id,
					source.content_hash ?? '',
					source.size_bytes,
					source.duration_us
				])
			)
		)
	);
}

function timelineFingerprint(project: VideoProjectDocumentV1): string {
	return toHex(
		sha256(
			JSON.stringify(
				project.primary_sequence.map((item) =>
					isPrimarySequenceClip(item)
						? [item.id, item.source_id, item.source_in_us, item.source_out_us, item.speed]
						: [item.id, 'gap', item.duration_us]
				)
			)
		)
	);
}

function normalizeToken(value: string): string {
	return value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function cachedAnalysisResult<T>(
	projectID: string,
	kind: 'transcript' | 'silence',
	sourceHash: string,
	timelineHash: string,
	algorithmVersion: string,
	settings: Record<string, unknown>
): Promise<T | undefined> {
	const expectedSettings = JSON.stringify(settings);
	const cached = (await listAnalysisResults(projectID, kind)).find(
		(result) =>
			result.source_hash === sourceHash &&
			result.timeline_fingerprint === timelineHash &&
			result.algorithm_version === algorithmVersion &&
			JSON.stringify(result.settings) === expectedSettings
	);
	return cached?.result as T | undefined;
}

class AnalysisWorker {
	private readonly worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
		type: 'module'
	});

	request<T extends Record<string, unknown> = Record<string, unknown>>(
		message: Record<string, unknown>,
		transfer: Transferable[] = [],
		signal?: AbortSignal,
		onProgress?: (message: Record<string, unknown>) => void
	): Promise<T> {
		const id = crypto.randomUUID();
		const timeoutMS =
			message.type === 'transcribe'
				? 180_000
				: message.type === 'vad-start'
					? 60_000
					: message.type === 'vad-chunk'
						? 30_000
						: 10_000;
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener('abort', abort);
				this.worker.removeEventListener('message', receive);
				this.worker.removeEventListener('error', fail);
			};
			const abort = () => {
				cleanup();
				reject(signal?.reason ?? new DOMException('Analysis cancelled.', 'AbortError'));
			};
			const receive = (event: MessageEvent<Record<string, unknown>>) => {
				if (event.data.id !== id) return;
				if (event.data.type === 'error') {
					cleanup();
					reject(new Error(String(event.data.message ?? 'Local analysis failed.')));
					return;
				}
				if (
					event.data.type === 'model-progress' ||
					event.data.type === 'device-fallback' ||
					event.data.type === 'vad-progress'
				) {
					onProgress?.(event.data);
					return;
				}
				cleanup();
				resolve(event.data as T);
			};
			const fail = (event: ErrorEvent) => {
				cleanup();
				reject(new Error(event.message || 'The local analysis worker stopped unexpectedly.'));
			};
			const timeout = setTimeout(() => {
				cleanup();
				this.worker.terminate();
				reject(
					new Error(
						message.type === 'transcribe'
							? 'Local transcription stopped responding. Retry this window or use the WASM fallback.'
							: 'Local voice analysis stopped responding. Retry the analysis.'
					)
				);
			}, timeoutMS);
			signal?.addEventListener('abort', abort, { once: true });
			this.worker.addEventListener('message', receive);
			this.worker.addEventListener('error', fail);
			this.worker.postMessage({ ...message, id }, transfer);
		});
	}

	close(): void {
		this.worker.terminate();
	}
}
