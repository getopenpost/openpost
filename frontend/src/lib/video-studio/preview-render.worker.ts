/// <reference lib="webworker" />

import type { VariantID, VideoProjectDocumentV1, VideoSource } from '@openpost/video-project';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { drawEvaluatedFrame, type SourceRuntime } from './frame-renderer';
import { evaluateFrame } from './render-graph';
import { WebGLFrameCompositor } from './webgl-compositor';

type PreviewMessage =
	| { type: 'initialize'; canvas: OffscreenCanvas }
	| {
			type: 'configure';
			revision: number;
			project: VideoProjectDocumentV1;
			files: Array<{ source_id: string; file: File }>;
	  }
	| { type: 'render'; request_id: number; variant_id: VariantID; timestamp_us: number }
	| { type: 'dispose' };

interface RuntimeEntry {
	runtime: SourceRuntime;
	last_used: number;
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
const runtimes = new Map<string, RuntimeEntry>();
const MAX_VIDEO_DECODERS = 3;

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
	for (const [sourceID, file] of nextFiles) files.set(sourceID, file);
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
	if (canvas.width !== frame.width || canvas.height !== frame.height) {
		compositor?.resize(frame.width, frame.height);
	}
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
	await drawEvaluatedFrame(context, frame, activeRuntimes);
	compositor?.present();
	postMessage({
		type: 'frame',
		request_id: request.request_id,
		timestamp_us: request.timestamp_us
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
	runtimes.set(sourceID, { runtime, last_used: ++useCounter });
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
	return {
		source,
		input,
		video: new VideoSampleSink(track, { optimizeForLatency: true })
	};
}

function disposeRuntime(runtime: SourceRuntime): void {
	runtime.image?.close();
	if (runtime.input && !runtime.input.disposed) runtime.input.dispose();
}

function disposeAll(): void {
	for (const entry of runtimes.values()) disposeRuntime(entry.runtime);
	runtimes.clear();
	files.clear();
	project = undefined;
	compositor?.dispose();
	compositor = undefined;
}

export {};
