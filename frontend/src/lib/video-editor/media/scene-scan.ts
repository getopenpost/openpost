/**
 * Scene scanning: decode a media file's video track at ~4 fps into a small
 * canvas grid, build per-sample frame histograms, and report detected cuts
 * as source-frame positions.
 *
 * Ported from FreeCut (MIT) — scene-sampling concept (histogram comparison
 * over sparsely decoded frames), retargeted to mediabunny + OpenPost's
 * FrameHistogram detection core.
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ensureProResDecoderForCodec } from './prores-decoder';
import { resolveMediaBlob } from './import.svelte';
import { detectSceneCuts, type FrameHistogram } from './scene-detection';
import { detectAdaptiveSceneCuts } from './scene-search/scene-analysis-client';
import { sceneCaptionProvider, type SceneCutFramePair } from './scene-search/ai/caption-provider';
import {
	SCENE_GRID_HEIGHT,
	SCENE_GRID_WIDTH,
	SCENE_SAMPLE_INTERVAL_SECONDS,
	rgbHistogram
} from './scene-math';
import type { MediaMetadata } from './types';
import { createLogger } from '../workspace-fs/logger';

const FALLBACK_FPS = 30;
const VERIFICATION_MAX_EDGE = 480;
const logger = createLogger('SceneScan');

export type SceneScanMode = 'fast' | 'adaptive-lfm';

export interface SceneScanProgress {
	stage: 'detecting' | 'thumbnails' | 'loading-model' | 'verifying';
	percent: number;
	completed: number;
	total: number;
}

export interface SceneScanOptions {
	/** Source fps of the timeline item using this media; falls back to media.fps. */
	sourceFps?: number;
	mode?: SceneScanMode;
	signal?: AbortSignal;
	onProgress?: (progress: SceneScanProgress) => void;
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('Scene scan cancelled', 'AbortError');
}

async function canvasToVerificationJpeg(
	canvas: HTMLCanvasElement | OffscreenCanvas
): Promise<Blob> {
	const width = canvas.width;
	const height = canvas.height;
	const scale = Math.min(1, VERIFICATION_MAX_EDGE / Math.max(width, height));
	const output = new OffscreenCanvas(
		Math.max(1, Math.round(width * scale)),
		Math.max(1, Math.round(height * scale))
	);
	const context = output.getContext('2d');
	if (!context) throw new Error('Unable to capture a scene verification frame');
	context.drawImage(canvas, 0, 0, output.width, output.height);
	return output.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

async function captureVerificationPairs(
	media: MediaMetadata,
	cutTimes: readonly number[],
	sourceFps: number,
	signal?: AbortSignal
): Promise<SceneCutFramePair[]> {
	const blob = await resolveMediaBlob(media);
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error(`No video track in ${media.fileName}`);
		await ensureProResDecoderForCodec(track.codec);
		const sink = new CanvasSink(track, { poolSize: 2 });
		const adjacentFrameSeconds = Math.max(1 / Math.max(sourceFps, 1), 1 / 120);
		const pairs: SceneCutFramePair[] = [];
		for (const cutTime of cutTimes) {
			if (signal?.aborted) throw abortError(signal);
			const before = await sink.getCanvas(Math.max(0, cutTime - adjacentFrameSeconds));
			const after = await sink.getCanvas(cutTime);
			if (!before || !after) throw new Error('Unable to decode scene verification frames');
			pairs.push({
				before: await canvasToVerificationJpeg(before.canvas),
				after: await canvasToVerificationJpeg(after.canvas)
			});
		}
		return pairs;
	} finally {
		input.dispose?.();
	}
}

async function scanAdaptiveSceneCuts(
	media: MediaMetadata,
	sourceFps: number,
	options: SceneScanOptions
): Promise<number[]> {
	const candidates = await detectAdaptiveSceneCuts(media, {
		signal: options.signal,
		onProgress: (progress) => options.onProgress?.(progress)
	});
	if (candidates.length === 0) return [];
	const cutTimes = candidates.map((cut) => cut.time);
	try {
		const pairs = await captureVerificationPairs(media, cutTimes, sourceFps, options.signal);
		const decisions = await sceneCaptionProvider.verifySceneCuts(pairs, {
			signal: options.signal,
			onProgress: (progress) => options.onProgress?.(progress)
		});
		return cutTimes
			.filter((_, index) => decisions[index] === true)
			.map((time) => Math.round(time * sourceFps));
	} catch (error) {
		if (options.signal?.aborted) throw abortError(options.signal);
		logger.warn('Local scene verification failed; using adaptive detector candidates', error);
		return cutTimes.map((time) => Math.round(time * sourceFps));
	}
}

/**
 * Decode sampled frames and return scene-cut positions in the media's own
 * source frames. Callers map these onto a specific item with
 * `cutFramesForItem` before splitting.
 */
export async function scanSceneCuts(
	media: MediaMetadata,
	options: SceneScanOptions = {}
): Promise<number[]> {
	const effectiveFps =
		options.sourceFps && options.sourceFps > 0
			? options.sourceFps
			: media.fps > 0
				? media.fps
				: FALLBACK_FPS;
	if (options.mode === 'adaptive-lfm') {
		return scanAdaptiveSceneCuts(media, effectiveFps, options);
	}

	const blob = await resolveMediaBlob(media);
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error(`No video track in ${media.fileName}`);
		await ensureProResDecoderForCodec(track.codec);
		const duration = await track.computeDuration();
		if (!(duration > 0)) return [];

		const sink = new CanvasSink(track, {
			width: SCENE_GRID_WIDTH,
			height: SCENE_GRID_HEIGHT,
			fit: 'fill'
		});
		const timestamps: number[] = [];
		for (let time = 0; time < duration; time += SCENE_SAMPLE_INTERVAL_SECONDS) {
			timestamps.push(time);
		}

		const histograms: FrameHistogram[] = [];
		let completed = 0;
		for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
			if (options.signal?.aborted) throw abortError(options.signal);
			completed += 1;
			options.onProgress?.({
				stage: 'detecting',
				percent: Math.round((completed / timestamps.length) * 100),
				completed,
				total: timestamps.length
			});
			if (!wrapped) continue;
			const context = wrapped.canvas.getContext('2d');
			if (!context || wrapped.canvas.width < 1 || wrapped.canvas.height < 1) continue;
			const { data } = context.getImageData(0, 0, wrapped.canvas.width, wrapped.canvas.height);
			histograms.push({
				timeSeconds: wrapped.timestamp,
				buckets: rgbHistogram(data, wrapped.canvas.width, wrapped.canvas.height)
			});
		}

		return detectSceneCuts(histograms).map((cut) => Math.round(cut.timeSeconds * effectiveFps));
	} finally {
		input.dispose?.();
	}
}
