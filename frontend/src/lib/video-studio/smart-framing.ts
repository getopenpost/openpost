import {
	derivePrimarySequence,
	isPrimarySequenceClip,
	type CropRectangle,
	type VariantID,
	type VideoProjectDocumentV1,
	type VideoSource
} from '@openpost/video-project';
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { openVideoProjectSource } from './source-access';

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
	motion_coverage: number;
}

export async function analyzeSmartFraming(
	project: VideoProjectDocumentV1,
	variantID: VariantID,
	options: {
		projectID?: string;
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
		if (!isPrimarySequenceClip(clip)) continue;
		const source = project.sources[clip.source_id];
		if (!source || source.kind === 'image') continue;
		const metrics = await analyzeClipFrames(source, clip.source_in_us, clip.source_out_us, {
			projectID: options.projectID,
			signal: options.signal,
			onProgress: (fraction) => options.onProgress?.((index + fraction) / derived.length)
		});
		if (metrics.length === 0) continue;
		const totalWeight = metrics.reduce((total, metric) => total + Math.max(0.05, metric.change), 0);
		const rawFocusX =
			metrics.reduce((total, metric) => total + metric.x * Math.max(0.05, metric.change), 0) /
			totalWeight;
		const rawFocusY =
			metrics.reduce((total, metric) => total + metric.y * Math.max(0.05, metric.change), 0) /
			totalWeight;
		const variant = project.variants.find((item) => item.id === variantID)!;
		const { x: focusX, y: focusY } = safeFocusPoint(
			variant.width / variant.height,
			rawFocusX,
			rawFocusY
		);
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
				metric.motion_coverage > 0.55 ||
				timelineUS - lastSuggestionUS < 2_500_000 ||
				timelineUS + 1_800_000 > timing.timeline_end_us
			) {
				continue;
			}
			const safeFocus = safeFocusPoint(variant.width / variant.height, metric.x, metric.y);
			result.focus_zooms.push({
				id: `focus:${clip.id}:${timelineUS}`,
				clip_id: clip.id,
				time_us: timelineUS,
				duration_us: 1_800_000,
				focus_x: safeFocus.x,
				focus_y: safeFocus.y,
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
	options: { projectID?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal }
): Promise<FrameMetric[]> {
	const blob = await openVideoProjectSource(options.projectID, source, options.signal);
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
	let changedSamples = 0;
	let sampledPixels = 0;
	for (let y = 1; y < SAMPLE_HEIGHT - 1; y += 2) {
		for (let x = 1; x < SAMPLE_WIDTH - 1; x += 2) {
			const offset = (y * SAMPLE_WIDTH + x) * 4;
			const luma = pixelLuma(pixels, offset);
			const edge =
				Math.abs(luma - pixelLuma(pixels, offset - 4)) +
				Math.abs(luma - pixelLuma(pixels, offset - SAMPLE_WIDTH * 4));
			const motion = previous ? Math.abs(luma - pixelLuma(previous, offset)) : 0;
			if (previous && motion >= 20) changedSamples += 1;
			sampledPixels += 1;
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
		change: change / Math.max(1, sampledPixels),
		motion_coverage: previous ? changedSamples / Math.max(1, sampledPixels) : 0
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

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function safeFocusPoint(
	targetAspect: number,
	focusX: number,
	focusY: number
): { x: number; y: number } {
	if (targetAspect <= 0.7) {
		return { x: clamp(focusX, 0.18, 0.82), y: clamp(focusY, 0.16, 0.72) };
	}
	if (targetAspect <= 0.9) {
		return { x: clamp(focusX, 0.16, 0.84), y: clamp(focusY, 0.14, 0.78) };
	}
	return { x: clamp(focusX, 0.12, 0.88), y: clamp(focusY, 0.12, 0.86) };
}
