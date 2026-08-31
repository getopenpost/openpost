/**
 * Multi-track rendered export: flattens every visible/audible timeline item
 * into one composed video file.
 *
 * Ported from FreeCut (MIT) - features/export/utils/canvas-render-orchestrator.ts,
 * client-renderer.ts, and canvas-audio.ts - retargeted to OpenPost's
 * TimelineItem model with a worker-safe render loop, explicit main-thread
 * fallback, persistent chunked audio DSP, and OPFS-backed output streaming.
 */

import {
	ALL_FORMATS,
	AdtsOutputFormat,
	AudioSample,
	AudioSampleSource,
	BlobSource,
	BufferTarget,
	CanvasSink,
	canEncodeVideo,
	getFirstEncodableVideoCodec,
	Input,
	MkvOutputFormat,
	MovOutputFormat,
	Mp3OutputFormat,
	Mp4OutputFormat,
	Output,
	StreamTarget,
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
import { renderSubtitleCueRaster, renderSubtitleRaster, renderTextItemRaster } from './text-raster';
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
import { shapeMasksForTrack } from '../shapes/masks';
import { LottieFrameProvider, mapTimelineFrameToLottieFrame } from '../lottie/frame-provider';
import {
	lottieRenderSignature,
	resolveLottieRenderSpec,
	type LottieRenderSpec
} from '../lottie/render-spec';
import { saveRenderedExportArtifact } from './persist-rendered-export';
import { assessSmartCopy } from './smart-copy-plan';
import { smartCopy } from './smart-copy';
import { applyCompositionControlOverrides } from '../sequences/composition-controls';
import { ensureProResDecoderForCodec } from './prores-decoder';
import { ensureAc3DecoderForCodec } from './ac3-decoder';
import { mixAudioWindows } from '../audio/bounded-audio-mixer';

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
const EXPORT_STREAM_CHUNK_BYTES = 16 * 1024 * 1024;
const EXPORT_SCRATCH_DIRECTORY = 'openpost-export-scratch';
const EXPORT_SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const VIDEO_BITRATES = {
	draft: 4_000_000,
	standard: 8_000_000,
	high: 16_000_000
} as const;

interface VideoDecoder {
	input: Input;
	sink: CanvasSink;
}

interface ArtifactTarget {
	target: BufferTarget | StreamTarget;
	finish(): Promise<Blob>;
	discard(): Promise<void>;
}

async function pruneStaleExportScratch(directory: FileSystemDirectoryHandle): Promise<void> {
	const cutoff = Date.now() - EXPORT_SCRATCH_MAX_AGE_MS;
	try {
		for await (const [name, handle] of directory.entries()) {
			if (handle.kind !== 'file') continue;
			try {
				const file = await handle.getFile();
				if (file.lastModified < cutoff) await directory.removeEntry(name);
			} catch {
				// A concurrent export or maintenance pass may have changed this entry.
			}
		}
	} catch {
		// Scratch cleanup must not block a new export.
	}
}

async function createArtifactTarget(mimeType: string, extension: string): Promise<ArtifactTarget> {
	if (globalThis.navigator?.storage?.getDirectory) {
		let directory: FileSystemDirectoryHandle | null = null;
		let fileName = '';
		try {
			const root = await globalThis.navigator.storage.getDirectory();
			directory = await root.getDirectoryHandle(EXPORT_SCRATCH_DIRECTORY, { create: true });
			await pruneStaleExportScratch(directory);
			fileName = `${crypto.randomUUID()}.${extension}`;
			const handle = await directory.getFileHandle(fileName, { create: true });
			const writable = await handle.createWritable();
			let settled = false;
			const remove = async (): Promise<void> => {
				if (settled) return;
				settled = true;
				try {
					await directory!.removeEntry(fileName);
				} catch {
					// The browser may already have removed an aborted scratch file.
				}
			};
			return {
				target: new StreamTarget(writable, {
					chunked: true,
					chunkSize: EXPORT_STREAM_CHUNK_BYTES
				}),
				async finish() {
					const file = await handle.getFile();
					// Chromium keeps OPFS-backed Blob data lazy. Removing the file here would
					// invalidate the artifact before save/download reads it. The next export
					// prunes completed scratch files after the retention window.
					return file.slice(0, file.size, mimeType);
				},
				discard: remove
			};
		} catch {
			if (directory && fileName) {
				try {
					await directory.removeEntry(fileName);
				} catch {
					// OPFS initialization failed before a usable target existed.
				}
			}
		}
	}
	const target = new BufferTarget();
	return {
		target,
		async finish() {
			if (!target.buffer) throw new Error('Render produced no data.');
			return new Blob([target.buffer], { type: mimeType });
		},
		async discard() {}
	};
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

function mixDurationSeconds(entries: MixEntry[]): number {
	return entries.reduce(
		(max, entry) => Math.max(max, entry.whenSeconds + entry.durationSeconds),
		0
	);
}

function entriesWithAudioSources(entries: MixEntry[]): MixEntry[] {
	return entries.filter((entry) => {
		const media = mediaPool.get(entry.mediaId);
		if (!media) return true;
		return (
			media.audioCodecSupported !== false &&
			(Boolean(media.audioCodec) || media.tags.includes('audio'))
		);
	});
}

export interface TimelineFrameRenderOptions {
	width?: number;
	height?: number;
	burnSubtitles?: boolean;
	backgroundColor?: string | null;
}

/** Shared full-resolution compositor used by export and still-frame capture. */
export class TimelineFrameRenderer {
	readonly canvas: OffscreenCanvas;
	private readonly width: number;
	private readonly height: number;
	private readonly backgroundColor: string | null;
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
		this.backgroundColor =
			options.backgroundColor !== undefined
				? options.backgroundColor
				: (project.metadata.backgroundColor ?? '#000000');
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
				item.type === 'background' ||
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

	private karaokeSubtitleSource(
		item: TimelineItem,
		cue: import('../project/types').SubtitleCue,
		frame: number
	) {
		const width = Math.max(1, Math.round(item.transform?.width ?? this.width));
		const height = Math.max(1, Math.round(item.transform?.height ?? this.height));
		this.textCanvas.width = width;
		this.textCanvas.height = height;
		const context = this.textCanvas.getContext('2d');
		if (!context) throw new Error('Failed to create the subtitle raster context.');
		renderSubtitleCueRaster(context, cue, item, width, height, frame);
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
		if (resolvedItem.type === 'background') return null;
		if (resolvedItem.type === 'subtitle') {
			const cue = selectCuesAtFrame(resolvedItem.cues ?? [], frame)[0];
			if (!cue) return null;
			// Shared karaoke helper guarantees preview and export resolve the same active word
			// at exact frame boundaries; fallback renders exactly as a normal caption.
			if (resolvedItem.captionHighlightMode === 'karaoke' && cue.words && cue.words.length > 0) {
				return this.karaokeSubtitleSource(resolvedItem, cue, frame);
			}
			return this.subtitleSource(resolvedItem, cue.text);
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
						burnSubtitles: true,
						backgroundColor: composition.backgroundColor ?? this.backgroundColor
					},
					new Set([...this.ancestry, composition.id])
				);
				this.nestedRenderers.set(rendererKey, renderer);
			}
			const nestedFrame = Math.max(
				0,
				Math.floor(
					frameToSourceSeconds(originalItem, frame, this.fps) *
						(originalItem.sourceFps ?? composition.fps)
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
			if (!source && resolvedItem.type !== 'background') return null;
			return {
				source,
				item: resolvedItem,
				alpha:
					itemOpacity(resolvedItem) * visualClipFadeOpacityAtFrame(resolvedItem, frame, this.fps),
				masks: shapeMasksForTrack(
					activeMasks,
					this.trackOrderById.get(item.trackId) ?? 0,
					this.trackOrderById
				)
			};
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

		this.stackCompositor.assertExactRender();
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
	const mixEntries = entriesWithAudioSources(
		sliceMixEntries(
			applyMixEntryGain(
				planNestedMixdown(
					items,
					tracks,
					fps,
					transitions,
					timeline?.compositions ?? [],
					new Set(),
					timeline?.busAudioEq
				),
				masterBusGain(timeline)
			),
			startFrame / fps,
			endFrame / fps
		)
	);
	report(options, 'mixing', 0, totalFrames);
	// Mixing is now streaming via bounded windows; report mixing as we feed windows during encoding.
	const hasAudio = mixEntries.length > 0;
	const audioDurationSeconds = hasAudio ? mixDurationSeconds(mixEntries) : 0;
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
	const artifactTarget = await createArtifactTarget(outputFormat.mimeType, format);
	const output = new Output({ format: outputFormat, target: artifactTarget.target });
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
	if (hasAudio) {
		audioSource = new AudioSampleSource({
			codec: format === 'webm' || format === 'mkv' ? 'opus' : 'aac',
			bitrate: 192_000
		});
		output.addAudioTrack(audioSource);
	}

	try {
		await output.start();
		if (subtitleSource) {
			await subtitleSource.add(subtitleWebVtt(items, fps, startFrame, endFrame));
			subtitleSource.close();
		}
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// The original start or subtitle failure matters more than cancel errors.
		}
		await artifactTarget.discard();
		throw error;
	}

	async function runFeed(): Promise<void> {
		if (!hasAudio || !audioSource) return;
		const source = audioSource;
		let samplesFed = 0;
		const totalSamples = Math.ceil(audioDurationSeconds * MIX_SAMPLE_RATE);
		try {
			for await (const win of mixAudioWindows(mixEntries, audioDurationSeconds, options.signal)) {
				throwIfAborted(options.signal);
				const windowSamples = win.samples[0]!.length;
				for (let off = 0; off < windowSamples; off += AUDIO_ENCODE_CHUNK_FRAMES) {
					throwIfAborted(options.signal);
					const frameCount = Math.min(AUDIO_ENCODE_CHUNK_FRAMES, windowSamples - off);
					const planar = new Float32Array(frameCount * MIX_CHANNELS);
					for (let c = 0; c < MIX_CHANNELS; c++)
						planar.set(win.samples[c]!.subarray(off, off + frameCount), c * frameCount);
					const sample = new AudioSample({
						data: planar,
						format: 'f32-planar',
						numberOfChannels: MIX_CHANNELS,
						sampleRate: MIX_SAMPLE_RATE,
						timestamp: (samplesFed + off) / MIX_SAMPLE_RATE
					});
					try {
						await source.add(sample);
					} finally {
						sample.close();
					}
				}
				samplesFed += windowSamples;
				const progress = totalSamples > 0 ? samplesFed / totalSamples : 1;
				report(options, 'encoding', Math.round(progress * totalFrames), totalFrames);
			}
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
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// The original failure below matters more than cancel errors.
		}
		await artifactTarget.discard();
		throw error;
	} finally {
		frameRenderer.dispose();
	}

	const blob = await artifactTarget.finish();
	const baseName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;
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
	const entries = entriesWithAudioSources(
		sliceMixEntries(
			applyMixEntryGain(
				planNestedMixdown(
					items,
					tracks,
					fps,
					transitions,
					project.timeline?.compositions ?? [],
					new Set(),
					project.timeline?.busAudioEq
				),
				masterBusGain(project.timeline)
			),
			startFrame / fps,
			endFrame / fps
		)
	);
	if (entries.length === 0) throw new Error('The selected range has no audible clips.');
	report(options, 'preparing', 0, totalFrames);
	report(options, 'mixing', 0, totalFrames);
	const durationSeconds = mixDurationSeconds(entries);
	if (durationSeconds <= 0) throw new Error('The audio mix is empty.');
	const format = audioOutputFormatFor(options.format);
	const artifactTarget = await createArtifactTarget(format.mimeType, options.format);
	const output = new Output({ format, target: artifactTarget.target });
	const codec = options.format === 'mp3' ? 'mp3' : options.format === 'aac' ? 'aac' : 'pcm-s16';
	const source = new AudioSampleSource({
		codec,
		bitrate: options.format === 'wav' ? undefined : 192_000
	});
	output.addAudioTrack(source);
	try {
		await output.start();
		throwIfAborted(options.signal);
		report(options, 'encoding', 0, totalFrames);
		let samplesFed = 0;
		const totalSamples = Math.ceil(durationSeconds * MIX_SAMPLE_RATE);
		let producedWindows = 0;
		for await (const win of mixAudioWindows(entries, durationSeconds, options.signal)) {
			throwIfAborted(options.signal);
			producedWindows++;
			const windowSamples = win.samples[0]!.length;
			for (let off = 0; off < windowSamples; off += AUDIO_ENCODE_CHUNK_FRAMES) {
				throwIfAborted(options.signal);
				const frameCount = Math.min(AUDIO_ENCODE_CHUNK_FRAMES, windowSamples - off);
				const planar = new Float32Array(frameCount * MIX_CHANNELS);
				for (let c = 0; c < MIX_CHANNELS; c++)
					planar.set(win.samples[c]!.subarray(off, off + frameCount), c * frameCount);
				const sample = new AudioSample({
					data: planar,
					format: 'f32-planar',
					numberOfChannels: MIX_CHANNELS,
					sampleRate: MIX_SAMPLE_RATE,
					timestamp: (samplesFed + off) / MIX_SAMPLE_RATE
				});
				try {
					await source.add(sample);
				} finally {
					sample.close();
				}
			}
			samplesFed += windowSamples;
			const ratio = totalSamples > 0 ? samplesFed / totalSamples : 1;
			report(options, 'encoding', Math.round(totalFrames * ratio), totalFrames);
		}
		if (producedWindows === 0) throw new Error('The audio mix is empty.');
		source.close();
		report(options, 'finalizing', totalFrames, totalFrames);
		await output.finalize();
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// Keep the first failure.
		}
		await artifactTarget.discard();
		throw error;
	}
	const blob = await artifactTarget.finish();
	const fileName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${options.format}`;
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
