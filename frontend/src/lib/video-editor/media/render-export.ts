/**
 * Multi-track rendered export: flattens every visible/audible timeline item
 * into one composed video file.
 *
 * Ported from FreeCut (MIT) — features/export/utils/canvas-render-orchestrator.ts,
 * client-renderer.ts, and canvas-audio.ts — retargeted to OpenPost's
 * TimelineItem model and trimmed to a single main-thread render loop with a
 * whole-timeline OfflineAudioContext mixdown (48 kHz stereo).
 */

import {
	ALL_FORMATS,
	AdtsOutputFormat,
	AudioSample,
	AudioSampleSink,
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
	type OutputFormat,
	type VideoCodec,
	TextSubtitleSource,
	VideoSample,
	VideoSampleSource,
	WavOutputFormat,
	WebMOutputFormat
} from 'mediabunny';
import { saveExportFile } from '../workspace-fs/exports';
import type { Project, TimelineItem, TimelineTransition } from '../project/types';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './import.svelte';
import { resolveAnimatedItemAt } from '../timeline/animated-properties';
import { scaleItemForCanvas } from './render-geometry';
import { renderSubtitleRaster, renderTextItemRaster } from './text-raster';
import { CanvasStackCompositor, itemOpacity } from './canvas-stack-compositor';
import {
	collectAdjustmentLayers,
	effectsForItemAtFrame,
	type AdjustmentLayerScope
} from '../effects/adjustment-layers';
import { subtitleSidecarSrt, subtitleWebVtt } from '../transcript/subtitle-export';
import { incomingOpacity, outgoingOpacity } from '../timeline/actions/transitions.svelte';
import {
	frameToSourceSeconds,
	isVisibleAtFrame,
	outputDurationFrames,
	paintOrder,
	planMixdown,
	selectCuesAtFrame,
	transitionBlendAtFrame,
	type MixEntry
} from './render-plan';

export interface RenderExportProgress {
	phase: 'preparing' | 'mixing' | 'rendering' | 'finalizing';
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

export interface AudioExportOptions {
	format: 'mp3' | 'aac' | 'wav';
	range?: { startFrame: number; endFrame: number };
	signal?: AbortSignal;
}

const MIX_SAMPLE_RATE = 48_000;
const MIX_CHANNELS = 2;
const AUDIO_ENCODE_CHUNK_FRAMES = 48_000;
const VIDEO_BITRATES = {
	draft: 4_000_000,
	standard: 8_000_000,
	high: 16_000_000
} as const;

interface VideoDecoder {
	input: Input;
	sink: CanvasSink;
}

function report(
	options: RenderExportOptions,
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
		source.buffer = buffer;
		source.playbackRate.value = entry.playbackRate;
		const gain = context.createGain();
		for (const point of entry.gainPoints) {
			gain.gain.setValueAtTime(Math.max(0, point.value), point.whenSeconds);
		}
		source.connect(gain).connect(context.destination);
		source.start(
			entry.whenSeconds,
			entry.sourceOffsetSeconds,
			entry.durationSeconds * entry.playbackRate
		);
	}
	return context.startRendering();
}

/** Ported from FreeCut (MIT) addAudioDataInChunks — feeds f32-planar chunks. */
async function feedEncodedAudio(
	audioSource: AudioSampleSource,
	buffer: AudioBuffer,
	onChunk?: () => void
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
			onChunk?.();
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
	private readonly inputs: Input[] = [];
	private readonly stackCompositor: CanvasStackCompositor;
	private readonly textCanvas = new OffscreenCanvas(1, 1);

	constructor(
		private readonly project: Project,
		options: TimelineFrameRenderOptions = {}
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
				item.type === 'text' ||
				(this.burnSubtitles && item.type === 'subtitle')
		);
		this.transitions = project.timeline?.transitions ?? [];
		this.itemsById = new Map(items.map((item) => [item.id, item]));
	}

	private textSource(item: TimelineItem) {
		const width = Math.max(1, Math.round(item.transform?.width ?? this.width));
		const height = Math.max(1, Math.round(item.transform?.height ?? this.height));
		this.textCanvas.width = width;
		this.textCanvas.height = height;
		const context = this.textCanvas.getContext('2d');
		if (!context) throw new Error('Failed to create the text raster context.');
		renderTextItemRaster(context, item, width, height);
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

	private async getDecoder(mediaId: string): Promise<VideoDecoder | null> {
		const existing = this.decoders.get(mediaId);
		if (existing) return existing;
		const media = mediaPool.get(mediaId);
		if (!media) return null;
		const blob = await resolveMediaBlob(media);
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		this.inputs.push(input);
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) return null;
		const decoder: VideoDecoder = {
			input,
			sink: new CanvasSink(videoTrack, { width: this.width, height: this.height, fit: 'contain' })
		};
		this.decoders.set(mediaId, decoder);
		return decoder;
	}

	async render(frame: number): Promise<OffscreenCanvas> {
		this.stackCompositor.beginFrame(this.width, this.height, this.backgroundColor);

		const blend = transitionBlendAtFrame(this.transitions, this.itemsById, frame);
		for (const item of this.orderedItems) {
			if (
				!isVisibleAtFrame(item, frame) &&
				item.id !== blend?.outgoingId &&
				item.id !== blend?.incomingId
			)
				continue;
			const resolvedItem = scaleItemForCanvas(
				resolveAnimatedItemAt(item, frame),
				this.width / this.project.metadata.width,
				this.height / this.project.metadata.height
			);
			resolvedItem.effects = effectsForItemAtFrame(
				resolvedItem,
				this.trackOrderById.get(item.trackId) ?? 0,
				this.adjustmentLayers,
				frame
			);
			let alpha = itemOpacity(resolvedItem);
			if (blend) {
				if (item.id === blend.outgoingId) alpha *= outgoingOpacity(blend.type, blend.progress);
				else if (item.id === blend.incomingId) alpha *= incomingOpacity(blend.type, blend.progress);
			}
			if (alpha <= 0) continue;
			if (resolvedItem.type === 'subtitle') {
				const cue = selectCuesAtFrame(resolvedItem.cues ?? [], frame)[0];
				if (!cue) continue;
				const raster = this.subtitleSource(resolvedItem, cue.text);
				this.stackCompositor.compositeLayer(raster, resolvedItem, alpha, frame / this.fps);
				continue;
			}
			if (resolvedItem.type === 'text') {
				const raster = this.textSource(resolvedItem);
				this.stackCompositor.compositeLayer(raster, resolvedItem, alpha, frame / this.fps);
				continue;
			}
			if (!resolvedItem.mediaId) continue;

			if (resolvedItem.type === 'video') {
				const decoder = await this.getDecoder(resolvedItem.mediaId);
				if (!decoder) continue;
				const wrapped = await decoder.sink.getCanvas(frameToSourceSeconds(item, frame, this.fps));
				if (!wrapped) continue;
				this.stackCompositor.compositeLayer(
					{
						source: wrapped.canvas,
						width: wrapped.canvas.width,
						height: wrapped.canvas.height
					},
					resolvedItem,
					alpha,
					frame / this.fps
				);
			} else {
				let bitmap = this.imageCache.get(resolvedItem.mediaId);
				if (!bitmap) {
					const media = mediaPool.get(resolvedItem.mediaId);
					if (!media) continue;
					bitmap = await createImageBitmap(await resolveMediaBlob(media));
					this.imageCache.set(resolvedItem.mediaId, bitmap);
				}
				this.stackCompositor.compositeLayer(
					{ source: bitmap, width: bitmap.width, height: bitmap.height },
					resolvedItem,
					alpha,
					frame / this.fps
				);
			}
		}

		return this.canvas;
	}

	dispose(): void {
		for (const input of this.inputs) input.dispose?.();
		for (const bitmap of this.imageCache.values()) bitmap.close();
		this.imageCache.clear();
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

/** Render the full timeline into one composed file and save it to exports. */
export async function renderMultiTrackVideo(
	project: Project,
	options: RenderExportOptions = {}
): Promise<RenderExportResult> {
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

	const transitions = timeline?.transitions ?? [];
	const mixEntries = sliceMixEntries(
		planMixdown(items, tracks, fps, transitions),
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
	const mixed =
		mixEntries.length > 0
			? await renderMixdown(mixEntries, decodedAudio, mixDurationSeconds(mixEntries))
			: null;

	const format = options.format ?? 'webm';
	const outputFormat = outputFormatFor(format);
	const requestedCodec = options.codec ?? defaultVideoCodec(format);
	const supportedCodecs = supportedExportVideoCodecs(format);
	if (!supportedCodecs.includes(requestedCodec)) {
		throw new Error(`${requestedCodec} cannot be stored in ${format.toUpperCase()}.`);
	}
	const bitrate = VIDEO_BITRATES[options.quality ?? 'standard'];
	const codec = (await canEncodeVideo(requestedCodec, { width, height, bitrate }))
		? requestedCodec
		: await getFirstEncodableVideoCodec(supportedCodecs, { width, height, bitrate });
	if (!codec) throw new Error(`This browser cannot encode video for ${format.toUpperCase()}.`);
	const target = new BufferTarget();
	const output = new Output({ format: outputFormat, target });
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
		await feedTask;
		report(options, 'finalizing', totalFrames, totalFrames);
		await output.finalize();
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// The original failure below matters more than cancel errors.
		}
		throw error;
	} finally {
		frameRenderer.dispose();
	}

	const buffer = target.buffer;
	if (!buffer) throw new Error('Render produced no data.');
	const blob = new Blob([buffer], { type: outputFormat.mimeType });
	const baseName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;
	const saved = await saveExportFile(project.id, baseName, blob);
	if (subtitleMode === 'sidecar') {
		const srt = subtitleSidecarSrt(items, fps, startFrame, endFrame);
		if (srt)
			await saveExportFile(
				project.id,
				`${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.srt`,
				new Blob([srt], { type: 'application/x-subrip' })
			);
	}
	return { ...saved, blob };
}

/** Render the audible timeline mix without a video track. */
export async function renderTimelineAudio(
	project: Project,
	options: AudioExportOptions
): Promise<RenderExportResult> {
	const fps = project.metadata.fps;
	const items = project.timeline?.items ?? [];
	const tracks = project.timeline?.tracks ?? [];
	const fullDuration = outputDurationFrames(items);
	const startFrame = Math.max(0, Math.floor(options.range?.startFrame ?? 0));
	const endFrame = Math.min(fullDuration, Math.ceil(options.range?.endFrame ?? fullDuration));
	const transitions = project.timeline?.transitions ?? [];
	const entries = sliceMixEntries(
		planMixdown(items, tracks, fps, transitions),
		startFrame / fps,
		endFrame / fps
	);
	if (entries.length === 0) throw new Error('The selected range has no audible clips.');
	const decoded = new Map<string, AudioBuffer>();
	for (const mediaId of new Set(entries.map((entry) => entry.mediaId))) {
		throwIfAborted(options.signal);
		const media = mediaPool.get(mediaId);
		if (media) decoded.set(mediaId, await decodeAudioBuffer(await resolveMediaBlob(media)));
	}
	const mixed = await renderMixdown(entries, decoded, mixDurationSeconds(entries));
	if (!mixed) throw new Error('The audio mix is empty.');
	const format = audioOutputFormatFor(options.format);
	const target = new BufferTarget();
	const output = new Output({ format, target });
	const codec = options.format === 'mp3' ? 'mp3' : options.format === 'aac' ? 'aac' : 'pcm-s16';
	const source = new AudioSampleSource({
		codec,
		bitrate: options.format === 'wav' ? undefined : 192_000
	});
	output.addAudioTrack(source);
	await output.start();
	try {
		throwIfAborted(options.signal);
		await feedEncodedAudio(source, mixed, () => throwIfAborted(options.signal));
		source.close();
		await output.finalize();
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// Keep the first failure.
		}
		throw error;
	}
	if (!target.buffer) throw new Error('Audio render produced no data.');
	const blob = new Blob([target.buffer], { type: format.mimeType });
	const fileName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${options.format}`;
	const saved = await saveExportFile(project.id, fileName, blob);
	return { ...saved, blob };
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

function sliceMixEntries(
	entries: MixEntry[],
	startSeconds: number,
	endSeconds: number
): MixEntry[] {
	return entries.flatMap((entry) => {
		const entryEnd = entry.whenSeconds + entry.durationSeconds;
		const overlapStart = Math.max(startSeconds, entry.whenSeconds);
		const overlapEnd = Math.min(endSeconds, entryEnd);
		if (overlapEnd <= overlapStart) return [];
		const skipped = overlapStart - entry.whenSeconds;
		return [
			{
				...entry,
				whenSeconds: overlapStart - startSeconds,
				sourceOffsetSeconds: entry.sourceOffsetSeconds + skipped * entry.playbackRate,
				durationSeconds: overlapEnd - overlapStart,
				gainPoints: entry.gainPoints
					.filter((point) => point.whenSeconds >= overlapStart && point.whenSeconds <= overlapEnd)
					.map((point) => ({
						...point,
						whenSeconds: point.whenSeconds - startSeconds
					}))
			}
		];
	});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
