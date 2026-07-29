import {
	derivePrimarySequence,
	type CropRectangle,
	type VariantID,
	type VideoProjectDocumentV1,
	type VideoSource
} from '@openpost/video-project';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { getAuthenticatedMediaByID } from '$lib/media-url';
import { readProjectFile } from './storage';

const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 54;

export interface FocusZoomSuggestion {
	id: string;
	clip_id: string;
	time_us: number;
	duration_us: number;
	focus_x: number;
	focus_y: number;
	confidence: number;
}

export interface ReframeSuggestion {
	clip_id: string;
	variant_id: VariantID;
	focus_x: number;
	focus_y: number;
	crop: CropRectangle;
	confidence: number;
}

export interface SmartFramingResult {
	reframes: ReframeSuggestion[];
	focus_zooms: FocusZoomSuggestion[];
}

interface FrameMetric {
	time_us: number;
	x: number;
	y: number;
	change: number;
}

export async function analyzeSmartFraming(
	project: VideoProjectDocumentV1,
	variantID: VariantID,
	options: {
		onProgress?: (fraction: number) => void;
		signal?: AbortSignal;
	} = {}
): Promise<SmartFramingResult> {
	const derived = derivePrimarySequence(project);
	const result: SmartFramingResult = { reframes: [], focus_zooms: [] };
	for (let index = 0; index < derived.length; index += 1) {
		options.signal?.throwIfAborted();
		const timing = derived[index]!;
		const clip = project.primary_sequence[timing.index]!;
		const source = project.sources[clip.source_id];
		if (!source || source.kind === 'image') continue;
		const metrics = await analyzeClipFrames(source, clip.source_in_us, clip.source_out_us, {
			signal: options.signal,
			onProgress: (fraction) => options.onProgress?.((index + fraction) / derived.length)
		});
		if (metrics.length === 0) continue;
		const totalWeight = metrics.reduce((total, metric) => total + Math.max(0.05, metric.change), 0);
		const focusX =
			metrics.reduce((total, metric) => total + metric.x * Math.max(0.05, metric.change), 0) /
			totalWeight;
		const focusY =
			metrics.reduce((total, metric) => total + metric.y * Math.max(0.05, metric.change), 0) /
			totalWeight;
		const variant = project.variants.find((item) => item.id === variantID)!;
		result.reframes.push({
			clip_id: clip.id,
			variant_id: variantID,
			focus_x: focusX,
			focus_y: focusY,
			crop: focusCrop(source, variant.width / variant.height, focusX, focusY),
			confidence: Math.min(0.95, 0.45 + metrics.length / 120)
		});
		const changeThreshold =
			(metrics.reduce((total, metric) => total + metric.change, 0) / metrics.length) * 1.6;
		let lastSuggestionUS = -3_000_000;
		for (const metric of metrics) {
			const timelineUS =
				timing.timeline_start_us + Math.round((metric.time_us - clip.source_in_us) / clip.speed);
			if (
				metric.change < changeThreshold ||
				timelineUS - lastSuggestionUS < 2_500_000 ||
				timelineUS + 1_800_000 > timing.timeline_end_us
			) {
				continue;
			}
			result.focus_zooms.push({
				id: crypto.randomUUID(),
				clip_id: clip.id,
				time_us: timelineUS,
				duration_us: 1_800_000,
				focus_x: metric.x,
				focus_y: metric.y,
				confidence: Math.min(0.92, 0.5 + metric.change)
			});
			lastSuggestionUS = timelineUS;
		}
	}
	options.onProgress?.(1);
	return result;
}

export function focusCrop(
	source: Pick<VideoSource, 'width' | 'height'>,
	targetAspect: number,
	focusX: number,
	focusY: number
): CropRectangle {
	const sourceAspect = source.width / Math.max(1, source.height);
	if (sourceAspect > targetAspect) {
		const width = Math.min(1, targetAspect / sourceAspect);
		return {
			x: clamp(focusX - width / 2, 0, 1 - width),
			y: 0,
			width,
			height: 1
		};
	}
	const height = Math.min(1, sourceAspect / targetAspect);
	return {
		x: 0,
		y: clamp(focusY - height / 2, 0, 1 - height),
		width: 1,
		height
	};
}

async function analyzeClipFrames(
	source: VideoSource,
	sourceInUS: number,
	sourceOutUS: number,
	options: { onProgress?: (fraction: number) => void; signal?: AbortSignal }
): Promise<FrameMetric[]> {
	const blob = await sourceBlob(source, options.signal);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track || !(await track.canDecode())) return [];
		const sink = new VideoSampleSink(track, { optimizeForLatency: true });
		const durationUS = sourceOutUS - sourceInUS;
		const stepUS = Math.max(500_000, Math.ceil(durationUS / 80));
		const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return [];
		const metrics: FrameMetric[] = [];
		let previous: Uint8ClampedArray | undefined;
		for (let timestampUS = sourceInUS; timestampUS < sourceOutUS; timestampUS += stepUS) {
			options.signal?.throwIfAborted();
			const sample = await sink.getSample(timestampUS / 1_000_000);
			if (!sample) continue;
			sample.draw(context, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
			sample.close();
			const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
			const metric = saliencyMetric(pixels, previous);
			metrics.push({ time_us: timestampUS, ...metric });
			previous = new Uint8ClampedArray(pixels);
			options.onProgress?.((timestampUS - sourceInUS) / Math.max(1, durationUS));
		}
		return stabilizeMetrics(metrics);
	} finally {
		input.dispose();
	}
}

function saliencyMetric(
	pixels: Uint8ClampedArray,
	previous?: Uint8ClampedArray
): Omit<FrameMetric, 'time_us'> {
	let weightedX = 0;
	let weightedY = 0;
	let weight = 0;
	let change = 0;
	for (let y = 1; y < SAMPLE_HEIGHT - 1; y += 2) {
		for (let x = 1; x < SAMPLE_WIDTH - 1; x += 2) {
			const offset = (y * SAMPLE_WIDTH + x) * 4;
			const luma = pixelLuma(pixels, offset);
			const edge =
				Math.abs(luma - pixelLuma(pixels, offset - 4)) +
				Math.abs(luma - pixelLuma(pixels, offset - SAMPLE_WIDTH * 4));
			const motion = previous ? Math.abs(luma - pixelLuma(previous, offset)) : 0;
			const localWeight = edge / 255 + motion / 170;
			weightedX += (x / SAMPLE_WIDTH) * localWeight;
			weightedY += (y / SAMPLE_HEIGHT) * localWeight;
			weight += localWeight;
			change += motion / 255;
		}
	}
	return {
		x: weight > 0 ? weightedX / weight : 0.5,
		y: weight > 0 ? weightedY / weight : 0.5,
		change: change / ((SAMPLE_WIDTH * SAMPLE_HEIGHT) / 4)
	};
}

function stabilizeMetrics(metrics: FrameMetric[]): FrameMetric[] {
	let x = 0.5;
	let y = 0.5;
	return metrics.map((metric) => {
		x = x * 0.72 + metric.x * 0.28;
		y = y * 0.72 + metric.y * 0.28;
		return { ...metric, x, y };
	});
}

function pixelLuma(pixels: Uint8ClampedArray, offset: number): number {
	return (
		(pixels[offset] ?? 0) * 0.2126 +
		(pixels[offset + 1] ?? 0) * 0.7152 +
		(pixels[offset + 2] ?? 0) * 0.0722
	);
}

async function sourceBlob(source: VideoSource, signal?: AbortSignal): Promise<Blob> {
	if (source.locator.type === 'local-opfs') {
		const file = await readProjectFile(source.locator.path);
		if (!file) throw new Error(`${source.original_name} is missing from local project storage.`);
		return file;
	}
	const response = await fetch(getAuthenticatedMediaByID(source.locator.media_id), { signal });
	if (!response.ok) throw new Error(`${source.original_name} could not be read.`);
	return await response.blob();
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
