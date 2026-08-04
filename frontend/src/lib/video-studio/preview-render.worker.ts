/// <reference lib="webworker" />

import type { VariantID, VideoProjectDocumentV1, VideoSource } from '@openpost/video-project';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { drawEvaluatedFrame, type SourceRuntime } from './frame-renderer';
import { evaluateFrame } from './render-graph';
import { WebGLFrameCompositor } from './webgl-compositor';
import { SequentialVideoSampler } from './sequential-video-sampler';

type PreviewMessage =
	| { type: 'initialize'; canvas: OffscreenCanvas }
	| {
			type: 'configure';
			revision: number;
			project: VideoProjectDocumentV1;
			files: Array<{ source_id: string; file: File; using_proxy: boolean }>;
	  }
	| {
			type: 'render';
			request_id: number;
			variant_id: VariantID;
			timestamp_us: number;
			playing: boolean;
	  }
	| { type: 'dispose' };

interface RuntimeEntry {
	runtime: SourceRuntime;
	last_used: number;
	using_proxy: boolean;
}

let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null = null;
let compositor: WebGLFrameCompositor | undefined;
let project: VideoProjectDocumentV1 | undefined;
let configuredRevision = -1;
let latestRequest: Extract<PreviewMessage, { type: 'render' }> | undefined;
let rendering = false;
let useCounter = 0;
const files = new Map<string, File>();
const proxySources = new Set<string>();
const runtimes = new Map<string, RuntimeEntry>();
const MAX_VIDEO_DECODERS = 3;
let droppedRenderRequests = 0;
let peakVideoDecoders = 0;

self.onmessage = (event: MessageEvent<PreviewMessage>) => {
	const message = event.data;
	if (message.type === 'initialize') {
		canvas = message.canvas;
		compositor = new WebGLFrameCompositor(canvas, 1, 1);
		context = compositor.context;
		postMessage({ type: 'ready' });
		return;
	}
	if (message.type === 'configure') {
		void configure(message);
		return;
	}
	if (message.type === 'render') {
		if (latestRequest) droppedRenderRequests += 1;
		latestRequest = message;
		void drainRenders();
		return;
	}
	disposeAll();
	close();
};

async function configure(message: Extract<PreviewMessage, { type: 'configure' }>): Promise<void> {
	if (message.revision < configuredRevision) return;
	configuredRevision = message.revision;
	project = message.project;
	const nextIDs = new Set(message.files.map((item) => item.source_id));
	const nextFiles = new Map(message.files.map((item) => [item.source_id, item.file]));
	for (const [sourceID, entry] of runtimes) {
		const previous = files.get(sourceID);
		const next = nextFiles.get(sourceID);
		if (
			!nextIDs.has(sourceID) ||
			!previous ||
			!next ||
			previous.size !== next.size ||
			previous.lastModified !== next.lastModified ||
			previous.name !== next.name
		) {
			disposeRuntime(entry.runtime);
			runtimes.delete(sourceID);
		}
	}
	files.clear();
	proxySources.clear();
	for (const item of message.files) {
		files.set(item.source_id, item.file);
		if (item.using_proxy) proxySources.add(item.source_id);
	}
	postMessage({ type: 'configured', revision: message.revision });
}

async function drainRenders(): Promise<void> {
	if (rendering) return;
	rendering = true;
	try {
		while (latestRequest) {
			const request = latestRequest;
			latestRequest = undefined;
			await render(request);
		}
	} catch (cause) {
		postMessage({
			type: 'error',
			message: cause instanceof Error ? cause.message : 'The preview renderer stopped.'
		});
	} finally {
		rendering = false;
	}
}

async function render(request: Extract<PreviewMessage, { type: 'render' }>): Promise<void> {
	if (!canvas || !context || !project) return;
	const frame = evaluateFrame(project, request.variant_id, request.timestamp_us);
	const activeSources = [
		...frame.primary_layers.map((layer) => layer.source_id),
		...frame.visual_layers.flatMap((layer) =>
			layer.item.type === 'media' || layer.item.type === 'camera' ? [layer.item.source_id] : []
		)
	];
	const activeRuntimes = new Map<string, SourceRuntime>();
	let activeVideoDecoders = 0;
	for (const sourceID of activeSources) {
		if (activeRuntimes.has(sourceID)) continue;
		const source = project.sources[sourceID];
		if (source?.kind !== 'image') {
			if (activeVideoDecoders >= MAX_VIDEO_DECODERS) continue;
			activeVideoDecoders += 1;
		}
		const runtime = await ensureRuntime(sourceID);
		if (runtime) activeRuntimes.set(sourceID, runtime);
	}
	peakVideoDecoders = Math.max(peakVideoDecoders, activeVideoDecoders);
	const renderFrame = scalePreviewFrame(frame, request.playing, activeVideoDecoders);
	if (canvas.width !== renderFrame.width || canvas.height !== renderFrame.height) {
		compositor?.resize(renderFrame.width, renderFrame.height);
	}
	const startedAt = performance.now();
	await drawEvaluatedFrame(context, renderFrame, activeRuntimes);
	compositor?.present();
	const samplerDiagnostics = [...activeRuntimes.values()]
		.map((runtime) => runtime.videoSampler?.diagnostics)
		.filter((item) => item !== undefined);
	postMessage({
		type: 'frame',
		request_id: request.request_id,
		timestamp_us: request.timestamp_us,
		diagnostics: {
			active_video_decoders: activeVideoDecoders,
			peak_video_decoders: peakVideoDecoders,
			dropped_render_requests: droppedRenderRequests,
			proxy_source_count: [...activeRuntimes.keys()].filter((sourceID) =>
				proxySources.has(sourceID)
			).length,
			sample_requests: samplerDiagnostics.reduce((sum, item) => sum + item.request_count, 0),
			discontinuity_seeks: samplerDiagnostics.reduce(
				(sum, item) => sum + item.discontinuity_count,
				0
			),
			render_ms: Math.round((performance.now() - startedAt) * 10) / 10,
			quality: renderFrame === frame ? 'full' : 'adaptive'
		}
	});
}

async function ensureRuntime(sourceID: string): Promise<SourceRuntime | undefined> {
	const existing = runtimes.get(sourceID);
	if (existing) {
		existing.last_used = ++useCounter;
		return existing.runtime;
	}
	if (!project) return undefined;
	const source = project.sources[sourceID];
	const file = files.get(sourceID);
	if (!source || !file) return undefined;
	if (source.kind !== 'image') await makeDecoderRoom();
	const runtime = await openRuntime(source, file);
	runtimes.set(sourceID, {
		runtime,
		last_used: ++useCounter,
		using_proxy: proxySources.has(sourceID)
	});
	return runtime;
}

async function makeDecoderRoom(): Promise<void> {
	const decoderEntries = [...runtimes.entries()].filter(([, entry]) => entry.runtime.video);
	if (decoderEntries.length < MAX_VIDEO_DECODERS) return;
	decoderEntries.sort((left, right) => left[1].last_used - right[1].last_used);
	const [sourceID, entry] = decoderEntries[0]!;
	disposeRuntime(entry.runtime);
	runtimes.delete(sourceID);
}

async function openRuntime(source: VideoSource, file: File): Promise<SourceRuntime> {
	if (source.kind === 'image') {
		return { source, image: await createImageBitmap(file) };
	}
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const track = await input.getPrimaryVideoTrack();
	if (!track || !(await track.canDecode())) {
		input.dispose();
		throw new Error(`${source.original_name} cannot be decoded for preview.`);
	}
	const video = new VideoSampleSink(track, { optimizeForLatency: true });
	return {
		source,
		input,
		video,
		videoSampler: new SequentialVideoSampler(video)
	};
}

function disposeRuntime(runtime: SourceRuntime): void {
	void runtime.videoSampler?.dispose();
	runtime.image?.close();
	if (runtime.input && !runtime.input.disposed) runtime.input.dispose();
}

function disposeAll(): void {
	for (const entry of runtimes.values()) disposeRuntime(entry.runtime);
	runtimes.clear();
	files.clear();
	proxySources.clear();
	project = undefined;
	compositor?.dispose();
	compositor = undefined;
}

function scalePreviewFrame(
	frame: ReturnType<typeof evaluateFrame>,
	playing: boolean,
	activeVideoDecoders: number
): ReturnType<typeof evaluateFrame> {
	if (!playing) return frame;
	const maximumLongSide = activeVideoDecoders > 2 ? 960 : 1280;
	const longSide = Math.max(frame.width, frame.height);
	if (longSide <= maximumLongSide) return frame;
	const scale = maximumLongSide / longSide;
	const width = Math.max(2, Math.round((frame.width * scale) / 2) * 2);
	const height = Math.max(2, Math.round((frame.height * scale) / 2) * 2);
	return {
		...frame,
		width,
		height,
		safe_area: {
			top: Math.round(frame.safe_area.top * scale),
			right: Math.round(frame.safe_area.right * scale),
			bottom: Math.round(frame.safe_area.bottom * scale),
			left: Math.round(frame.safe_area.left * scale)
		}
	};
}

export {};
