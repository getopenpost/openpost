/** Scene detection and thumbnail extraction worker. Ported from FreeCut (MIT). */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ensureProResDecoderForCodec } from '../prores-decoder';
import {
	classifyAdaptiveSceneCuts,
	compareFrameFeatures,
	extractFrameFeatures,
	type AdaptiveFrameScore,
	type FrameFeatures
} from './adaptive-scene-detector';
import type { SceneCut } from './scene-types';
import { extractDominantColors, type PaletteEntry } from './dominant-colors';

const THUMBNAIL_MAX_EDGE = 384;
const THUMBNAIL_QUALITY = 0.8;

export interface SceneAnalysisWorkerRequest {
	type: 'analyze';
	requestId: string;
	blob: Blob;
	includeThumbnails?: boolean;
}

export interface SceneAnalysisWorkerAbortRequest {
	type: 'abort';
	requestId: string;
}

export interface SceneAnalysisWorkerProgress {
	type: 'progress';
	requestId: string;
	stage: 'detecting' | 'thumbnails';
	percent: number;
	completed: number;
	total: number;
}

export interface ExtractedSceneFrame {
	index: number;
	startSec: number;
	endSec: number;
	timeSec: number;
	cutScore?: number;
	thumbnail: Blob;
	palette: PaletteEntry[];
	colorPhrase: string;
}

export interface SceneAnalysisWorkerComplete {
	type: 'complete';
	requestId: string;
	durationSec: number;
	cuts: SceneCut[];
	scenes: ExtractedSceneFrame[];
}

export interface SceneAnalysisWorkerError {
	type: 'error';
	requestId: string;
	error: string;
}

export type SceneAnalysisWorkerResponse =
	| SceneAnalysisWorkerProgress
	| SceneAnalysisWorkerComplete
	| SceneAnalysisWorkerError;

type WorkerRequest = SceneAnalysisWorkerRequest | SceneAnalysisWorkerAbortRequest;
const active = new Map<string, { aborted: boolean }>();

function postProgress(
	requestId: string,
	stage: SceneAnalysisWorkerProgress['stage'],
	completed: number,
	total: number
): void {
	self.postMessage({
		type: 'progress',
		requestId,
		stage,
		completed,
		total,
		percent: total > 0 ? Math.round((completed / total) * 100) : 100
	} satisfies SceneAnalysisWorkerProgress);
}

async function canvasToJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
	if (canvas instanceof OffscreenCanvas) {
		return canvas.convertToBlob({ type: 'image/jpeg', quality: THUMBNAIL_QUALITY });
	}
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Scene thumbnail encoding failed'))),
			'image/jpeg',
			THUMBNAIL_QUALITY
		);
	});
}

async function run(
	request: SceneAnalysisWorkerRequest,
	state: { aborted: boolean }
): Promise<void> {
	const input = new Input({ source: new BlobSource(request.blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('No video track found');
		await ensureProResDecoderForCodec(track.codec);
		const durationSec = await track.computeDuration();
		if (!(durationSec > 0)) {
			self.postMessage({
				type: 'complete',
				requestId: request.requestId,
				durationSec: 0,
				cuts: [],
				scenes: []
			} satisfies SceneAnalysisWorkerComplete);
			return;
		}

		const adaptiveSink = new CanvasSink(track, { width: 96, poolSize: 1 });
		const scores: AdaptiveFrameScore[] = [];
		let previous: FrameFeatures | null = null;
		let twoFramesBack: FrameFeatures | null = null;
		let decoded = 0;
		for await (const wrapped of adaptiveSink.canvases()) {
			if (state.aborted) return;
			const context = wrapped.canvas.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('Unable to read scene-analysis frames');
			const pixels = context.getImageData(0, 0, wrapped.canvas.width, wrapped.canvas.height).data;
			const current = extractFrameFeatures(pixels, wrapped.canvas.width, wrapped.canvas.height);
			if (previous) {
				if (twoFramesBack && scores.length > 0) {
					scores[scores.length - 1]!.returnScore = compareFrameFeatures(
						twoFramesBack,
						current
					).contentScore;
				}
				scores.push({
					frameIndex: decoded,
					time: wrapped.timestamp,
					...compareFrameFeatures(previous, current)
				});
			}
			twoFramesBack = previous;
			previous = current;
			decoded += 1;
			const percent = Math.min(99, Math.floor((wrapped.timestamp / durationSec) * 100));
			if (decoded <= 3 || decoded % 12 === 0) {
				postProgress(request.requestId, 'detecting', percent, 100);
			}
		}
		postProgress(request.requestId, 'detecting', 100, 100);

		const cuts = classifyAdaptiveSceneCuts(scores);
		if (request.includeThumbnails === false) {
			self.postMessage({
				type: 'complete',
				requestId: request.requestId,
				durationSec,
				cuts,
				scenes: []
			} satisfies SceneAnalysisWorkerComplete);
			return;
		}

		const boundaries = [0, ...cuts.map((cut) => cut.time), durationSec]
			.filter((time, index, values) => index === 0 || time - values[index - 1]! >= 0.05)
			.toSorted((left, right) => left - right);
		if (boundaries.at(-1)! < durationSec) boundaries.push(durationSec);

		const [squareWidth, squareHeight, rotation] = await Promise.all([
			track.getSquarePixelWidth(),
			track.getSquarePixelHeight(),
			track.getRotation()
		]);
		const rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
		const displayWidth = rotated ? squareHeight : squareWidth;
		const displayHeight = rotated ? squareWidth : squareHeight;
		const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(displayWidth, displayHeight));
		const thumbSink = new CanvasSink(track, {
			width: Math.max(2, Math.round(displayWidth * scale)),
			height: Math.max(2, Math.round(displayHeight * scale)),
			fit: 'fill',
			poolSize: 3
		});
		const sceneTimes = boundaries.slice(0, -1).map((startSec, index) => {
			const endSec = boundaries[index + 1] ?? durationSec;
			return Math.min(
				endSec - 0.01,
				startSec + Math.min(0.2, Math.max(0.01, (endSec - startSec) / 4))
			);
		});
		const scenes: ExtractedSceneFrame[] = [];
		let sceneIndex = 0;
		for await (const wrapped of thumbSink.canvasesAtTimestamps(sceneTimes)) {
			if (state.aborted) return;
			const index = sceneIndex++;
			if (!wrapped) continue;
			const thumbnail = await canvasToJpeg(wrapped.canvas);
			const colors = await extractDominantColors(thumbnail);
			const startSec = boundaries[index]!;
			const endSec = boundaries[index + 1] ?? durationSec;
			scenes.push({
				index,
				startSec,
				endSec,
				timeSec: wrapped.timestamp,
				cutScore: index > 0 ? cuts[index - 1]?.score : undefined,
				thumbnail,
				palette: colors.palette,
				colorPhrase: colors.phrase
			});
			postProgress(request.requestId, 'thumbnails', sceneIndex, sceneTimes.length);
		}

		if (!state.aborted) {
			self.postMessage({
				type: 'complete',
				requestId: request.requestId,
				durationSec,
				cuts,
				scenes
			} satisfies SceneAnalysisWorkerComplete);
		}
	} finally {
		input.dispose();
	}
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const request = event.data;
	if (request.type === 'abort') {
		const state = active.get(request.requestId);
		if (state) state.aborted = true;
		return;
	}
	const state = { aborted: false };
	active.set(request.requestId, state);
	void run(request, state)
		.catch((error) => {
			if (state.aborted) return;
			self.postMessage({
				type: 'error',
				requestId: request.requestId,
				error: error instanceof Error ? error.message : String(error)
			} satisfies SceneAnalysisWorkerError);
		})
		.finally(() => active.delete(request.requestId));
};
