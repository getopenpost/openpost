/**
 * Multi-track rendered export: flattens every visible/audible timeline item
 * into one composed video file.
 *
 * Ported from FreeCut (MIT) — features/export/utils/canvas-render-orchestrator.ts,
 * client-renderer.ts, and canvas-audio.ts — retargeted to OpenPost's
 * TimelineItem model with a worker-safe render loop, explicit main-thread
 * fallback, and whole-timeline OfflineAudioContext mixdown (48 kHz stereo).
 */

import {
	ALL_FORMATS,
	AdtsOutputFormat,
	AudioSample,
	AudioSampleSink,
	AudioSampleSource,
	BlobSource,
	BufferTarget,
	StreamTarget,
	CanvasSink,
	canEncodeVideo,
	getFirstEncodableVideoCodec,
	Input,
	MkvOutputFormat,
	MovOutputFormat,
	Mp3OutputFormat,
	Mp4OutputFormat,
	Output,
	type OutputFormat,
	type VideoCodec,
	TextSubtitleSource,
	VideoSample,
	VideoSampleSource,
	WavOutputFormat,
	WebMOutputFormat
} from 'mediabunny';
import type { Project, TimelineItem, TimelineTransition } from '../project/types';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './resolve-media-blob';
import { resolveAnimatedItemAt } from '../timeline/animated-properties';
import { scaleItemForCanvas } from './render-geometry';
import { renderSubtitleRaster, renderTextItemRaster } from './text-raster';
import { renderShapeItemRaster } from '../shapes/render';
import { animatedFrameIndexForItem, isAnimatedImageMedia } from './animated-image-plan';
import { animatedImageCache } from './animated-image-client';
import type { AnimatedImageFrames as AnimatedImageFramesResult } from './animated-image-client';
import {
	CanvasStackCompositor,
	itemOpacity,
	type StackLayerSource,
	type StackTransitionParticipant
} from './canvas-stack-compositor';
import { visualClipFadeOpacityAtFrame } from './clip-fades';
import {
	collectAdjustmentLayers,
	effectsForItemAtFrame,
	type AdjustmentLayerScope
} from '../effects/adjustment-layers';
import { subtitleSidecarSrt, subtitleWebVtt } from '../transcript/subtitle-export';
import {
	frameToSourceSeconds,
	applyMixEntryGain,
	isVisibleAtFrame,
	masterBusGain,
	outputDurationFrames,
	paintOrder,
	planNestedMixdown,
	selectCuesAtFrame,
	sliceMixEntries,
	transitionBlendAtFrame,
	type MixEntry
} from './render-plan';
import { reverseAudioWindow, type ReversedAudioWindow } from '../audio/reverse-audio';
import { processAudioChannels } from '../audio/process-audio';
import { buildTransitionGainCurve } from '../audio/transition-crossfade';
import { shapeMasksForTrack } from '../shapes/masks';
import { LottieFrameProvider, mapTimelineFrameToLottieFrame } from '../lottie/frame-provider';
import {
	lottieRenderSignature,
	resolveLottieRenderSpec,
	type LottieRenderSpec
} from '../lottie/render-spec';
import { createStreamingOutputTarget } from '$lib/video/stream-target';
import { saveRenderedExportArtifact } from './persist-rendered-export';
import { assessSmartCopy } from './smart-copy-plan';
import { smartCopy } from './smart-copy';
import { applyCompositionControlOverrides } from '../sequences/composition-controls';
import { ensureProResDecoderForCodec } from './prores-decoder';
import { ensureAc3DecoderForCodec } from './ac3-decoder';

export interface RenderExportProgress {
	phase: 'preparing' | 'mixing' | 'rendering' | 'encoding' | 'finalizing';
	framesDone: number;
	totalFrames: number;
	progress: number;
}

export interface RenderExportOptions {
	format?: 'webm' | 'mp4' | 'mov' | 'mkv';
	codec?: VideoCodec;
	quality?: 'draft' | 'standard' | 'high';
	width?: number;
	height?: number;
	range?: { startFrame: number; endFrame: number };
	burnSubtitles?: boolean;
	subtitleMode?: 'none' | 'burn' | 'sidecar' | 'embedded';
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

export interface RenderExportResult {
	fileName: string;
	relPath: string;
	blob: Blob;
}

export interface RenderedExportArtifact {
	fileName: string;
	blob: Blob;
	sidecar?: { fileName: string; blob: Blob };
	renderMethod?: 'smart-copy' | 'rendered';
}

export interface AudioExportOptions {
	format: 'mp3' | 'aac' | 'wav';
	range?: { startFrame: number; endFrame: number };
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

const MIX_SAMPLE_RATE = 48_000;
const MIX_CHANNELS = 2;
const AUDIO_ENCODE_CHUNK_FRAMES = 48_000;
const VIDEO_BITRATES = {
	draft: 4_000_000,
	standard: 8_000_000,
	high: 16_000_000
} as const;

export const STREAMING_EXPORT_THRESHOLD_BYTES = 50 * 1024 * 1024;

export function shouldStreamExport(estimatedBytes: number): boolean {
	if (!Number.isFinite(estimatedBytes) || estimatedBytes <= 0) return false;
	return estimatedBytes > STREAMING_EXPORT_THRESHOLD_BYTES;
}

export function isStreamingTargetAvailable(): boolean {
	try {
		return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
	} catch {
		return false;
	}
}

interface VideoDecoder {
	input: Input;
	sink: CanvasSink;
}

function report(
	options: Pick<RenderExportOptions, 'onProgress'>,
	phase: RenderExportProgress['phase'],
	framesDone: number,
	totalFrames: number
): void {
	options.onProgress?.({
		phase,
		framesDone,
		totalFrames,
		progress: totalFrames > 0 ? framesDone / totalFrames : 0
	});
}

/** Decode the primary audio track to an AudioBuffer at its native rate. */
async function decodeAudioBuffer(blob: Blob): Promise<AudioBuffer> {
	const input = new Input({
		source: new BlobSource(blob),
		formats: ALL_FORMATS
	});
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Clip has no audio to mix');
		await ensureAc3DecoderForCodec(track.codec);
		const sink = new AudioSampleSink(track);
		const channels: Float32Array[][] = [];
		let totalFrames = 0;
		let sampleRate = track.sampleRate || MIX_SAMPLE_RATE;
		for await (const sample of sink.samples()) {
			try {
				sampleRate = sample.sampleRate || sampleRate;
				const frameCount = sample.numberOfFrames;
				const planes: Float32Array[] = [];
				for (let c = 0; c < sample.numberOfChannels; c++) {
					// SAFETY: copyTo fills a planar f32 view of the decoded sample.
					const plane = new Float32Array(frameCount);
					sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
					planes.push(plane);
				}
				channels.push(planes);
				totalFrames += frameCount;
			} finally {
				sample.close();
			}
		}
		const outChannels = Math.min(MIX_CHANNELS, Math.max(1, channels[0]?.length ?? 1));
		const context = new OfflineAudioContext(outChannels, Math.max(1, totalFrames), sampleRate);
		const buffer = context.createBuffer(outChannels, Math.max(1, totalFrames), sampleRate);
		for (let c = 0; c < outChannels; c++) {
			const data = buffer.getChannelData(c);
			let offset = 0;
			for (const planes of channels) {
				data.set(planes[c] ?? planes[0] ?? new Float32Array(0), offset);
				offset += planes[0]?.length ?? 0;
			}
		}
		return buffer;
	} finally {
		input.dispose?.();
	}
}

function mixDurationSeconds(entries: MixEntry[]): number {
	return entries.reduce(
		(max, entry) => Math.max(max, entry.whenSeconds + entry.durationSeconds),
		0
	);
}

async function renderMixdown(
	entries: MixEntry[],
	decoded: Map<string, AudioBuffer>,
	durationSeconds: number
): Promise<AudioBuffer | null> {
	if (entries.length === 0) return null;
	const length = Math.max(1, Math.ceil(durationSeconds * MIX_SAMPLE_RATE));
	const context = new OfflineAudioContext(MIX_CHANNELS, length, MIX_SAMPLE_RATE);
	for (const entry of entries) {
		const buffer = decoded.get(entry.mediaId);
		if (!buffer) continue;
		const source = context.createBufferSource();
		const sourceDuration = entry.durationSeconds * entry.playbackRate;
		const window = entry.reversed
			? reverseAudioWindow(buffer, entry.sourceOffsetSeconds, sourceDuration)
			: copyAudioWindow(buffer, entry.sourceOffsetSeconds, sourceDuration);
		if (window.channels[0]?.length === 0) continue;
		const processedChannels = await processAudioChannels(window.channels, {
			speed: entry.playbackRate,
			pitchShiftSemitones: entry.pitchShiftSemitones,
			sampleRate: window.sampleRate,
			eqStages: entry.audioEqStages
		});
		if (processedChannels[0]?.length === 0) continue;
		const sourceBuffer = context.createBuffer(
			processedChannels.length,
			processedChannels[0]!.length,
			window.sampleRate
		);
		for (let channel = 0; channel < processedChannels.length; channel++) {
			sourceBuffer.getChannelData(channel).set(processedChannels[channel]!);
		}
		source.buffer = sourceBuffer;
		const gain = context.createGain();
		const points = entry.gainPoints.toSorted((left, right) => left.whenSeconds - right.whenSeconds);
		const firstPoint = points[0];
		if (firstPoint) {
			gain.gain.setValueAtTime(Math.max(0, firstPoint.value), firstPoint.whenSeconds);
			for (const point of points.slice(1)) {
				gain.gain.linearRampToValueAtTime(Math.max(0, point.value), point.whenSeconds);
			}
		}
		const transitionGain = context.createGain();
		const entryEnd = entry.whenSeconds + entry.durationSeconds;
		for (const span of entry.transitionGainSpans) {
			const spanEnd = span.startSeconds + span.durationSeconds;
			const start = Math.max(entry.whenSeconds, span.startSeconds);
			const end = Math.min(entryEnd, spanEnd);
			if (end <= start || span.durationSeconds <= 0) continue;
			const curve = buildTransitionGainCurve(span, start, end, context.sampleRate);
			transitionGain.gain.setValueCurveAtTime(curve, start, end - start);
		}
		source.connect(gain).connect(transitionGain).connect(context.destination);
		source.start(entry.whenSeconds, 0, Math.min(entry.durationSeconds, sourceBuffer.duration));
	}
	return context.startRendering();
}

function copyAudioWindow(
	buffer: AudioBuffer,
	startSeconds: number,
	durationSeconds: number
): ReversedAudioWindow {
	const startFrame = Math.min(
		buffer.length,
		Math.max(0, Math.round(startSeconds * buffer.sampleRate))
	);
	const requestedFrames = Math.max(0, Math.round(durationSeconds * buffer.sampleRate));
	const endFrame = Math.min(buffer.length, startFrame + requestedFrames);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
		buffer.getChannelData(channel).slice(startFrame, endFrame)
	);
	return { channels, sampleRate: buffer.sampleRate };
}

/** Ported from FreeCut (MIT) addAudioDataInChunks — feeds f32-planar chunks. */
async function feedEncodedAudio(
	audioSource: AudioSampleSource,
	buffer: AudioBuffer,
	onChunk?: (framesDone: number, totalFrames: number) => void
): Promise<void> {
	const channelCount = buffer.numberOfChannels;
	const channelData: Float32Array[] = [];
	for (let c = 0; c < channelCount; c++) channelData.push(buffer.getChannelData(c));
	for (let offset = 0; offset < buffer.length; offset += AUDIO_ENCODE_CHUNK_FRAMES) {
		const frameCount = Math.min(AUDIO_ENCODE_CHUNK_FRAMES, buffer.length - offset);
		const planar = new Float32Array(frameCount * channelCount);
		for (let c = 0; c < channelCount; c++) {
			const samples = channelData[c];
			if (samples) planar.set(samples.subarray(offset, offset + frameCount), c * frameCount);
		}
		const sample = new AudioSample({
			data: planar,
			format: 'f32-planar',
			numberOfChannels: channelCount,
			sampleRate: buffer.sampleRate,
			timestamp: offset / buffer.sampleRate
		});
		try {
			await audioSource.add(sample);
			onChunk?.(Math.min(buffer.length, offset + frameCount), buffer.length);
		} finally {
			sample.close();
		}
	}
}

export interface TimelineFrameRenderOptions {
	width?: number;
	height?: number;
	burnSubtitles?: boolean;
}

/** Shared full-resolution compositor used by export and still-frame capture. */
export class TimelineFrameRenderer {
	readonly canvas: OffscreenCanvas;
	private readonly width: number;
	private readonly height: number;
	private readonly backgroundColor: string;
	private readonly fps: number;
	private readonly orderedItems: TimelineItem[];
	private readonly transitions: TimelineTransition[];
	private readonly itemsById: Map<string, TimelineItem>;
	private readonly burnSubtitles: boolean;
	private readonly trackOrderById: Map<string, number>;
	private readonly adjustmentLayers: AdjustmentLayerScope[];
	private readonly decoders = new Map<string, VideoDecoder>();
	private readonly imageCache = new Map<string, ImageBitmap>();
	private readonly animatedFrames = new Map<string, Promise<AnimatedImageFramesResult | null>>();
	private readonly inputs: Input[] = [];
	private readonly stackCompositor: CanvasStackCompositor;
	private readonly textCanvas = new OffscreenCanvas(1, 1);
	private readonly nestedRenderers = new Map<string, TimelineFrameRenderer>();
	private readonly lottieProvider = new LottieFrameProvider();
	private readonly lottieBlobs = new Map<string, Blob>();
	private readonly lottieSpecs = new Map<string, Promise<LottieRenderSpec>>();

	constructor(
		private readonly project: Project,
		options: TimelineFrameRenderOptions = {},
		private readonly ancestry: ReadonlySet<string> = new Set()
	) {
		this.width = options.width ?? project.metadata.width;
		this.height = options.height ?? project.metadata.height;
		this.canvas = new OffscreenCanvas(this.width, this.height);
		this.stackCompositor = new CanvasStackCompositor(this.canvas);
		this.backgroundColor = project.metadata.backgroundColor ?? '#000000';
		this.fps = project.metadata.fps;
		const items = project.timeline?.items ?? [];
		const tracks = project.timeline?.tracks ?? [];
		this.trackOrderById = new Map(tracks.map((track) => [track.id, track.order]));
		this.adjustmentLayers = collectAdjustmentLayers(items, tracks);
		this.burnSubtitles = options.burnSubtitles ?? true;
		this.orderedItems = paintOrder(items, tracks).filter(
			(item) =>
				item.type === 'video' ||
				item.type === 'image' ||
				item.type === 'lottie' ||
				item.type === 'text' ||
				item.type === 'shape' ||
				item.type === 'composition' ||
				(this.burnSubtitles && item.type === 'subtitle')
		);
		this.transitions = project.timeline?.transitions ?? [];
		this.itemsById = new Map(items.map((item) => [item.id, item]));
	}

	private textSource(item: TimelineItem, frame: number) {
		const width = Math.max(1, Math.round(item.transform?.width ?? this.width));
		const height = Math.max(1, Math.round(item.transform?.height ?? this.height));
		this.textCanvas.width = width;
		this.textCanvas.height = height;
		const context = this.textCanvas.getContext('2d');
		if (!context) throw new Error('Failed to create the text raster context.');
		renderTextItemRaster(context, item, width, height, {
			absoluteFrame: frame
		});
		return {
			source: this.textCanvas,
			width,
			height
		};
	}

	private subtitleSource(item: TimelineItem, text: string) {
		const width = Math.max(1, Math.round(item.transform?.width ?? this.width));
		const height = Math.max(1, Math.round(item.transform?.height ?? this.height));
		this.textCanvas.width = width;
		this.textCanvas.height = height;
		const context = this.textCanvas.getContext('2d');
		if (!context) throw new Error('Failed to create the subtitle raster context.');
		renderSubtitleRaster(context, text, item, width, height);
		return {
			source: this.textCanvas,
			width,
			height
		};
	}

	private shapeSource(item: TimelineItem) {
		const width = Math.max(1, Math.round(item.transform?.width ?? this.width));
		const height = Math.max(1, Math.round(item.transform?.height ?? this.height));
		this.textCanvas.width = width;
		this.textCanvas.height = height;
		const context = this.textCanvas.getContext('2d');
		if (!context) throw new Error('Failed to create the shape raster context.');
		renderShapeItemRaster(context, item, width, height);
		return { source: this.textCanvas, width, height };
	}

	private async getDecoder(mediaId: string): Promise<VideoDecoder | null> {
		const existing = this.decoders.get(mediaId);
		if (existing) return existing;
		const media = mediaPool.get(mediaId);
		if (!media) return null;
		const blob = await resolveMediaBlob(media);
		const input = new Input({
			source: new BlobSource(blob),
			formats: ALL_FORMATS
		});
		this.inputs.push(input);
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) return null;
		await ensureProResDecoderForCodec(videoTrack.codec);
		const decoder: VideoDecoder = {
			input,
			sink: new CanvasSink(videoTrack, {
				width: this.width,
				height: this.height,
				fit: 'contain'
			})
		};
		this.decoders.set(mediaId, decoder);
		return decoder;
	}

	private async getLottieBlob(mediaId: string): Promise<Blob | null> {
		const cached = this.lottieBlobs.get(mediaId);
		if (cached) return cached;
		const media = mediaPool.get(mediaId);
		if (!media) return null;
		const blob = await resolveMediaBlob(media);
		this.lottieBlobs.set(mediaId, blob);
		return blob;
	}

	private getLottieSpec(item: TimelineItem, blob: Blob): Promise<LottieRenderSpec> {
		const input = {
			animationId: item.lottieAnimationId,
			themeId: item.lottieThemeId,
			textOverrides: item.lottieTextOverrides,
			colorOverrides: item.lottieColorOverrides,
			slotOverrides: item.lottieSlotOverrides
		};
		const signature = lottieRenderSignature(input);
		const key = `${item.id}:${signature}`;
		let spec = this.lottieSpecs.get(key);
		if (!spec) {
			spec = blob
				.arrayBuffer()
				.then((buffer) => resolveLottieRenderSpec(new Uint8Array(buffer), input));
			this.lottieSpecs.set(key, spec);
		}
		return spec;
	}

	private async animatedImageSource(
		item: TimelineItem,
		mediaId: string,
		frame: number
	): Promise<StackLayerSource | null> {
		const media = mediaPool.get(mediaId);
		if (!isAnimatedImageMedia(media)) return null;
		let framesPromise = this.animatedFrames.get(mediaId);
		if (!framesPromise) {
			if (!media) return null;
			framesPromise = animatedImageCache.getAnimatedImage(media);
			this.animatedFrames.set(mediaId, framesPromise);
		}
		let resolved: AnimatedImageFramesResult | null;
		try {
			resolved = await framesPromise;
		} catch (error) {
			// Known animations must fail clearly so a static poster cannot hide a broken loop.
			throw new Error(
				`Animated image decode failed for ${media?.fileName ?? mediaId}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
		if (!resolved || !(resolved.totalDurationMs > 0)) {
			throw new Error(`Animated image has no playable duration: ${media?.fileName ?? mediaId}`);
		}
		const index = animatedFrameIndexForItem({
			frame,
			fromFrame: item.from,
			fps: this.fps,
			speed: item.speed ?? 1,
			reversed: item.isReversed === true,
			totalDurationMs: resolved.totalDurationMs,
			cumulativeDelaysMs: resolved.cumulativeDelaysMs
		});
		const bitmap = resolved.frames[index];
		if (!bitmap) {
			throw new Error(`Animated image frame ${index} missing for ${media?.fileName ?? mediaId}`);
		}
		return { source: bitmap, width: resolved.width, height: resolved.height };
	}

	private async sourceForItem(
		resolvedItem: TimelineItem,
		originalItem: TimelineItem,
		frame: number
	): Promise<StackLayerSource | null> {
		if (resolvedItem.type === 'subtitle') {
			const cue = selectCuesAtFrame(resolvedItem.cues ?? [], frame)[0];
			return cue ? this.subtitleSource(resolvedItem, cue.text) : null;
		}
		if (resolvedItem.type === 'text') return this.textSource(resolvedItem, frame);
		if (resolvedItem.type === 'shape') return this.shapeSource(resolvedItem);
		if (resolvedItem.type === 'composition' && resolvedItem.compositionId) {
			if (this.ancestry.has(resolvedItem.compositionId)) return null;
			const composition = this.project.timeline?.compositions?.find(
				(candidate) => candidate.id === resolvedItem.compositionId
			);
			if (!composition) return null;
			const rendererKey = `${composition.id}:${originalItem.id}:${JSON.stringify(originalItem.compositionControlOverrides ?? {})}`;
			let renderer = this.nestedRenderers.get(rendererKey);
			if (!renderer) {
				const compositionItems = applyCompositionControlOverrides(
					composition.items,
					composition.compositionControls,
					originalItem.compositionControlOverrides
				);
				renderer = new TimelineFrameRenderer(
					{
						...this.project,
						metadata: {
							width: composition.width,
							height: composition.height,
							fps: composition.fps,
							backgroundColor: composition.backgroundColor ?? '#000000'
						},
						timeline: {
							items: compositionItems,
							tracks: composition.tracks,
							transitions: composition.transitions,
							compositions: this.project.timeline?.compositions
						}
					},
					{
						width: composition.width,
						height: composition.height,
						burnSubtitles: true
					},
					new Set([...this.ancestry, composition.id])
				);
				this.nestedRenderers.set(rendererKey, renderer);
			}
			const sourceFps = originalItem.sourceFps ?? composition.fps;
			const nestedFrame = Math.max(
				0,
				Math.floor(
					(originalItem.sourceStart ?? 0) +
						((frame - originalItem.from) / this.fps) * (originalItem.speed ?? 1) * sourceFps
				)
			);
			const source = await renderer.render(nestedFrame);
			return { source, width: composition.width, height: composition.height };
		}
		if (!resolvedItem.mediaId) return null;
		if (resolvedItem.type === 'lottie') {
			const blob = await this.getLottieBlob(resolvedItem.mediaId);
			if (!blob) return null;
			const spec = await this.getLottieSpec(originalItem, blob);
			const width = Math.max(
				1,
				Math.round(resolvedItem.transform?.width ?? resolvedItem.sourceWidth ?? this.width)
			);
			const height = Math.max(
				1,
				Math.round(resolvedItem.transform?.height ?? resolvedItem.sourceHeight ?? this.height)
			);
			const lottieFrame = mapTimelineFrameToLottieFrame({
				localFrame: frame - originalItem.from + (originalItem.lottiePhaseOffset ?? 0),
				projectFps: this.fps,
				speed: originalItem.speed ?? 1,
				totalFrames: originalItem.lottieTotalFrames ?? 1,
				frameRate: originalItem.lottieFrameRate ?? originalItem.sourceFps ?? 30,
				loop: originalItem.lottieLoop ?? true,
				reversed: originalItem.lottieReversed,
				loopMode: originalItem.lottieLoopMode,
				segmentStart: originalItem.lottieSegmentStart,
				segmentEnd: originalItem.lottieSegmentEnd
			});
			const source = await this.lottieProvider.source(
				originalItem.id,
				blob,
				width,
				height,
				lottieFrame,
				spec
			);
			return source ? { source, width, height } : null;
		}
		if (resolvedItem.type === 'video') {
			const decoder = await this.getDecoder(resolvedItem.mediaId);
			if (!decoder) return null;
			const wrapped = await decoder.sink.getCanvas(
				frameToSourceSeconds(originalItem, frame, this.fps)
			);
			return wrapped
				? {
						source: wrapped.canvas,
						width: wrapped.canvas.width,
						height: wrapped.canvas.height
					}
				: null;
		}
		if (resolvedItem.mediaId) {
			const animated = await this.animatedImageSource(originalItem, resolvedItem.mediaId, frame);
			if (animated) return animated;
		}
		let bitmap = this.imageCache.get(resolvedItem.mediaId);
		if (!bitmap) {
			const media = mediaPool.get(resolvedItem.mediaId);
			if (!media) return null;
			bitmap = await createImageBitmap(await resolveMediaBlob(media));
			this.imageCache.set(resolvedItem.mediaId, bitmap);
		}
		return { source: bitmap, width: bitmap.width, height: bitmap.height };
	}

	async render(frame: number): Promise<OffscreenCanvas> {
		this.stackCompositor.beginFrame(this.width, this.height, this.backgroundColor);
		const activeMasks = this.orderedItems
			.filter(
				(item) => item.type === 'shape' && item.isMask === true && isVisibleAtFrame(item, frame)
			)
			.map((item) =>
				scaleItemForCanvas(
					resolveAnimatedItemAt(item, frame, {
						fps: this.fps,
						frameWidth: this.project.metadata.width,
						frameHeight: this.project.metadata.height,
						items: this.project.timeline?.items ?? []
					}),
					this.width / this.project.metadata.width,
					this.height / this.project.metadata.height
				)
			);

		const blend = transitionBlendAtFrame(this.transitions, this.itemsById, frame);
		const resolveParticipant = async (
			item: TimelineItem
		): Promise<StackTransitionParticipant | null> => {
			const resolvedItem = scaleItemForCanvas(
				resolveAnimatedItemAt(item, frame, {
					fps: this.fps,
					frameWidth: this.project.metadata.width,
					frameHeight: this.project.metadata.height,
					items: this.project.timeline?.items ?? []
				}),
				this.width / this.project.metadata.width,
				this.height / this.project.metadata.height
			);
			resolvedItem.effects = effectsForItemAtFrame(
				resolvedItem,
				this.trackOrderById.get(item.trackId) ?? 0,
				this.adjustmentLayers,
				frame
			);
			const source = await this.sourceForItem(resolvedItem, item, frame);
			return source
				? {
						source,
						item: resolvedItem,
						alpha:
							itemOpacity(resolvedItem) *
							visualClipFadeOpacityAtFrame(resolvedItem, frame, this.fps),
						masks: shapeMasksForTrack(
							activeMasks,
							this.trackOrderById.get(item.trackId) ?? 0,
							this.trackOrderById
						)
					}
				: null;
		};
		let transitionRendered = false;
		for (const item of this.orderedItems) {
			if (item.type === 'shape' && item.isMask === true) continue;
			if (
				!isVisibleAtFrame(item, frame) &&
				item.id !== blend?.outgoingId &&
				item.id !== blend?.incomingId
			)
				continue;
			if (blend && (item.id === blend.outgoingId || item.id === blend.incomingId)) {
				if (transitionRendered) continue;
				const outgoingItem = this.itemsById.get(blend.outgoingId);
				const incomingItem = this.itemsById.get(blend.incomingId);
				if (!outgoingItem || !incomingItem) continue;
				const [outgoing, incoming] = await Promise.all([
					resolveParticipant(outgoingItem),
					resolveParticipant(incomingItem)
				]);
				if (!outgoing || !incoming) continue;
				this.stackCompositor.compositeTransition(
					outgoing,
					incoming,
					blend.transition,
					blend.progress,
					frame / this.fps
				);
				transitionRendered = true;
				continue;
			}
			const participant = await resolveParticipant(item);
			if (!participant || participant.alpha <= 0) continue;
			this.stackCompositor.compositeLayer(
				participant.source,
				participant.item,
				participant.alpha,
				frame / this.fps,
				participant.masks
			);
		}

		return this.canvas;
	}

	dispose(): void {
		for (const input of this.inputs) input.dispose?.();
		for (const renderer of this.nestedRenderers.values()) renderer.dispose();
		this.nestedRenderers.clear();
		for (const bitmap of this.imageCache.values()) bitmap.close();
		this.imageCache.clear();
		this.lottieProvider.destroy();
		this.lottieBlobs.clear();
		this.lottieSpecs.clear();
		this.stackCompositor.dispose();
	}
}

export async function renderTimelineFrame(
	project: Project,
	frame: number,
	options: TimelineFrameRenderOptions = {}
): Promise<Blob> {
	const renderer = new TimelineFrameRenderer(project, options);
	try {
		await renderer.render(Math.max(0, Math.round(frame)));
		return await renderer.canvas.convertToBlob({ type: 'image/png' });
	} finally {
		renderer.dispose();
	}
}

/** Render the full timeline without choosing where the resulting bytes are stored. */
export async function renderMultiTrackVideoArtifact(
	project: Project,
	options: RenderExportOptions = {}
): Promise<RenderedExportArtifact> {
	const fps = project.metadata.fps;
	const width = options.width ?? project.metadata.width;
	const height = options.height ?? project.metadata.height;
	const timeline = project.timeline;
	const items = timeline?.items ?? [];
	if (items.length === 0) throw new Error('This timeline has nothing to render.');
	const tracks = timeline?.tracks ?? [];
	const fullDuration = outputDurationFrames(items);
	const startFrame = Math.max(0, Math.floor(options.range?.startFrame ?? 0));
	const endFrame = Math.min(fullDuration, Math.ceil(options.range?.endFrame ?? fullDuration));
	const totalFrames = Math.max(0, endFrame - startFrame);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');

	report(options, 'preparing', 0, totalFrames);
	const smartCopyAssessment = assessSmartCopy(project, options, mediaPool.mediaList);
	if (smartCopyAssessment.eligible) {
		try {
			const copied = await smartCopy(smartCopyAssessment.plan, project.name, {
				signal: options.signal,
				onProgress: ({ phase, progress }) =>
					report(options, phase, Math.round(progress * totalFrames), totalFrames)
			});
			let sidecar: RenderedExportArtifact['sidecar'];
			if (smartCopyAssessment.plan.subtitleMode === 'sidecar') {
				const srt = subtitleSidecarSrt(items, fps, startFrame, endFrame);
				if (srt) {
					sidecar = {
						fileName: `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.srt`,
						blob: new Blob([srt], { type: 'application/x-subrip' })
					};
				}
			}
			return { ...copied, sidecar, renderMethod: 'smart-copy' };
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			// Source metadata can change after import. A normal render remains safe.
		}
	}

	const transitions = timeline?.transitions ?? [];
	const mixEntries = sliceMixEntries(
		applyMixEntryGain(
			planNestedMixdown(items, tracks, fps, transitions, timeline?.compositions ?? []),
			masterBusGain(timeline)
		),
		startFrame / fps,
		endFrame / fps
	);
	const decodedAudio = new Map<string, AudioBuffer>();
	for (const mediaId of new Set(mixEntries.map((entry) => entry.mediaId))) {
		const media = mediaPool.get(mediaId);
		if (!media) continue;
		try {
			decodedAudio.set(mediaId, await decodeAudioBuffer(await resolveMediaBlob(media)));
		} catch {
			// Silent or unreadable audio drops out of the mix rather than failing export.
		}
	}
	report(options, 'mixing', 0, totalFrames);
	const decodableMixEntries = mixEntries.filter((entry) => decodedAudio.has(entry.mediaId));
	const mixed =
		decodableMixEntries.length > 0
			? await renderMixdown(
					decodableMixEntries,
					decodedAudio,
					mixDurationSeconds(decodableMixEntries)
				)
			: null;
	report(options, 'rendering', 0, totalFrames);

	const format = options.format ?? 'webm';
	const outputFormat = outputFormatFor(format);
	const requestedCodec = options.codec ?? defaultVideoCodec(format);
	const supportedCodecs = supportedExportVideoCodecs(format);
	if (!supportedCodecs.includes(requestedCodec)) {
		throw new Error(`${requestedCodec} cannot be stored in ${format.toUpperCase()}.`);
	}
	const bitrate = VIDEO_BITRATES[options.quality ?? 'standard'];
	const codec = (await canEncodeVideo(requestedCodec, {
		width,
		height,
		bitrate
	}))
		? requestedCodec
		: await getFirstEncodableVideoCodec(supportedCodecs, {
				width,
				height,
				bitrate
			});
	if (!codec) throw new Error(`This browser cannot encode video for ${format.toUpperCase()}.`);
	const estimatedBytes =
		(VIDEO_BITRATES[options.quality ?? 'standard'] * (totalFrames / Math.max(1, fps))) / 8 +
		(mixed ? (192_000 * (totalFrames / Math.max(1, fps))) / 8 : 0);
	const useStreaming = isStreamingTargetAvailable() && shouldStreamExport(estimatedBytes);
	let bufferTarget: BufferTarget | null = null;
	let streamingTarget: Awaited<ReturnType<typeof createStreamingOutputTarget>> | null = null;
	let outputTarget: BufferTarget | StreamTarget;
	if (useStreaming) {
		try {
			streamingTarget = await createStreamingOutputTarget(options.signal);
			outputTarget = streamingTarget.target;
		} catch {
			streamingTarget = null;
			bufferTarget = new BufferTarget();
			outputTarget = bufferTarget;
		}
	} else {
		bufferTarget = new BufferTarget();
		outputTarget = bufferTarget;
	}
	const output = new Output({ format: outputFormat, target: outputTarget });
	const videoSource = new VideoSampleSource({
		codec,
		bitrate,
		keyFrameInterval: 2,
		latencyMode: 'quality'
	});
	output.addVideoTrack(videoSource, { frameRate: fps });
	const requestedSubtitleMode =
		options.subtitleMode ?? (options.burnSubtitles === false ? 'none' : 'burn');
	const subtitleMode = resolveSubtitleMode(requestedSubtitleMode, format);
	let subtitleSource: TextSubtitleSource | null = null;
	if (subtitleMode === 'embedded') {
		subtitleSource = new TextSubtitleSource('webvtt');
		output.addSubtitleTrack(subtitleSource);
	}

	let audioSource: AudioSampleSource | null = null;
	if (mixed) {
		audioSource = new AudioSampleSource({
			codec: format === 'webm' || format === 'mkv' ? 'opus' : 'aac',
			bitrate: 192_000
		});
		output.addAudioTrack(audioSource);
	}

	await output.start();
	if (subtitleSource) {
		await subtitleSource.add(subtitleWebVtt(items, fps, startFrame, endFrame));
		subtitleSource.close();
	}

	async function runFeed(): Promise<void> {
		if (!mixed || !audioSource) return;
		const source = audioSource;
		try {
			await feedEncodedAudio(source, mixed);
		} finally {
			source.close();
			audioSource = null;
		}
	}
	const feedTask = runFeed();
	feedTask.catch(() => undefined);

	const frameRenderer = new TimelineFrameRenderer(project, {
		width,
		height,
		burnSubtitles: subtitleMode === 'burn'
	});

	let finalized = false;
	try {
		for (let outputFrame = 0; outputFrame < totalFrames; outputFrame++) {
			throwIfAborted(options.signal);
			const frame = startFrame + outputFrame;
			const canvas = await frameRenderer.render(frame);

			const sample = new VideoSample(canvas, {
				timestamp: outputFrame / fps,
				duration: 1 / fps
			});
			await videoSource.add(sample);
			sample.close();

			report(options, 'rendering', outputFrame + 1, totalFrames);
		}

		videoSource.close();
		report(options, 'encoding', totalFrames, totalFrames);
		await feedTask;
		report(options, 'finalizing', totalFrames, totalFrames);
		await output.finalize();
		finalized = true;
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// The original failure below matters more than cancel errors.
		}
		if (streamingTarget) await streamingTarget.discard().catch(() => undefined);
		throw error;
	} finally {
		frameRenderer.dispose();
	}

	const baseName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;
	let blob: Blob;
	if (streamingTarget) {
		try {
			if (!finalized) throw new Error('Render produced no data.');
			blob = await streamingTarget.file(baseName, outputFormat.mimeType);
		} catch (error) {
			await streamingTarget.discard().catch(() => undefined);
			throw error;
		}
	} else {
		const buffer = bufferTarget?.buffer;
		if (!buffer) throw new Error('Render produced no data.');
		blob = new Blob([buffer], { type: outputFormat.mimeType });
	}
	let sidecar: RenderedExportArtifact['sidecar'];
	if (subtitleMode === 'sidecar') {
		const srt = subtitleSidecarSrt(items, fps, startFrame, endFrame);
		if (srt) {
			sidecar = {
				fileName: `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.srt`,
				blob: new Blob([srt], { type: 'application/x-subrip' })
			};
		}
	}
	return { fileName: baseName, blob, sidecar, renderMethod: 'rendered' };
}

/** Render a timeline to bytes for internal caches without creating a user export. */
export async function renderMultiTrackVideoBlob(
	project: Project,
	options: RenderExportOptions = {}
): Promise<Blob> {
	return (await renderMultiTrackVideoArtifact(project, options)).blob;
}

/** Render the full timeline into one composed file and save it to exports. */
export async function renderMultiTrackVideo(
	project: Project,
	options: RenderExportOptions = {}
): Promise<RenderExportResult> {
	return saveRenderedExportArtifact(
		project.id,
		await renderMultiTrackVideoArtifact(project, options)
	);
}

/** Render the audible timeline mix to an in-memory artifact. */
export async function renderTimelineAudioArtifact(
	project: Project,
	options: AudioExportOptions
): Promise<RenderedExportArtifact> {
	const fps = project.metadata.fps;
	const items = project.timeline?.items ?? [];
	const tracks = project.timeline?.tracks ?? [];
	const fullDuration = outputDurationFrames(items);
	const startFrame = Math.max(0, Math.floor(options.range?.startFrame ?? 0));
	const endFrame = Math.min(fullDuration, Math.ceil(options.range?.endFrame ?? fullDuration));
	const totalFrames = Math.max(0, endFrame - startFrame);
	const transitions = project.timeline?.transitions ?? [];
	const entries = sliceMixEntries(
		applyMixEntryGain(
			planNestedMixdown(items, tracks, fps, transitions, project.timeline?.compositions ?? []),
			masterBusGain(project.timeline)
		),
		startFrame / fps,
		endFrame / fps
	);
	if (entries.length === 0) throw new Error('The selected range has no audible clips.');
	report(options, 'preparing', 0, totalFrames);
	const decoded = new Map<string, AudioBuffer>();
	for (const mediaId of new Set(entries.map((entry) => entry.mediaId))) {
		throwIfAborted(options.signal);
		const media = mediaPool.get(mediaId);
		if (media) decoded.set(mediaId, await decodeAudioBuffer(await resolveMediaBlob(media)));
	}
	report(options, 'mixing', 0, totalFrames);
	const mixed = await renderMixdown(entries, decoded, mixDurationSeconds(entries));
	if (!mixed) throw new Error('The audio mix is empty.');
	const format = audioOutputFormatFor(options.format);
	const estimatedAudioBytes =
		((options.format === 'wav' ? 48_000 * 2 * 16 : 192_000) * (totalFrames / Math.max(1, fps))) / 8;
	const useAudioStreaming = isStreamingTargetAvailable() && shouldStreamExport(estimatedAudioBytes);
	let audioBufferTarget: BufferTarget | null = null;
	let audioStreamingTarget: Awaited<ReturnType<typeof createStreamingOutputTarget>> | null = null;
	let audioOutputTarget: BufferTarget | StreamTarget;
	if (useAudioStreaming) {
		try {
			audioStreamingTarget = await createStreamingOutputTarget(options.signal);
			audioOutputTarget = audioStreamingTarget.target;
		} catch {
			audioStreamingTarget = null;
			audioBufferTarget = new BufferTarget();
			audioOutputTarget = audioBufferTarget;
		}
	} else {
		audioBufferTarget = new BufferTarget();
		audioOutputTarget = audioBufferTarget;
	}
	const output = new Output({ format, target: audioOutputTarget });
	const codec = options.format === 'mp3' ? 'mp3' : options.format === 'aac' ? 'aac' : 'pcm-s16';
	const source = new AudioSampleSource({
		codec,
		bitrate: options.format === 'wav' ? undefined : 192_000
	});
	output.addAudioTrack(source);
	await output.start();
	try {
		throwIfAborted(options.signal);
		report(options, 'encoding', 0, totalFrames);
		await feedEncodedAudio(source, mixed, (encodedFrames, encodedTotal) => {
			throwIfAborted(options.signal);
			const ratio = encodedTotal > 0 ? encodedFrames / encodedTotal : 1;
			report(options, 'encoding', Math.round(totalFrames * ratio), totalFrames);
		});
		source.close();
		report(options, 'finalizing', totalFrames, totalFrames);
		await output.finalize();
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// Keep the first failure.
		}
		if (audioStreamingTarget) await audioStreamingTarget.discard().catch(() => undefined);
		throw error;
	}
	const fileName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${options.format}`;
	let blob: Blob;
	if (audioStreamingTarget) {
		try {
			blob = await audioStreamingTarget.file(fileName, format.mimeType);
		} catch (error) {
			await audioStreamingTarget.discard().catch(() => undefined);
			throw error;
		}
	} else {
		if (!audioBufferTarget?.buffer) throw new Error('Audio render produced no data.');
		blob = new Blob([audioBufferTarget.buffer], { type: format.mimeType });
	}
	return { fileName, blob };
}

/** Render the audible timeline mix without a video track and save it. */
export async function renderTimelineAudio(
	project: Project,
	options: AudioExportOptions
): Promise<RenderExportResult> {
	return saveRenderedExportArtifact(
		project.id,
		await renderTimelineAudioArtifact(project, options)
	);
}

function outputFormatFor(format: NonNullable<RenderExportOptions['format']>): OutputFormat {
	switch (format) {
		case 'webm':
			return new WebMOutputFormat();
		case 'mp4':
			return new Mp4OutputFormat();
		case 'mov':
			return new MovOutputFormat();
		case 'mkv':
			return new MkvOutputFormat();
	}
}

export function supportedExportVideoCodecs(
	format: NonNullable<RenderExportOptions['format']>
): VideoCodec[] {
	return outputFormatFor(format)
		.getSupportedVideoCodecs()
		.filter((codec) => codec !== 'prores');
}

export function defaultVideoCodec(format: NonNullable<RenderExportOptions['format']>): VideoCodec {
	return format === 'webm' ? 'vp9' : 'avc';
}

export function resolveSubtitleMode(
	mode: NonNullable<RenderExportOptions['subtitleMode']>,
	format: NonNullable<RenderExportOptions['format']>
): NonNullable<RenderExportOptions['subtitleMode']> {
	if (mode === 'embedded' && format !== 'webm' && format !== 'mkv') return 'burn';
	return mode;
}

function audioOutputFormatFor(format: AudioExportOptions['format']): OutputFormat {
	switch (format) {
		case 'mp3':
			return new Mp3OutputFormat();
		case 'aac':
			return new AdtsOutputFormat();
		case 'wav':
			return new WavOutputFormat();
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
