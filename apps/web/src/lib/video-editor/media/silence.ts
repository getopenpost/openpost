/**
 * Silence removal flow: decode a clip's audio via mediabunny, run the
 * windowed-RMS detector, then apply the shared range-removal machinery as
 * one undo step.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import type { AudioSilenceDetectionOptions } from '../audio/audio-silence';
import { detectSilentRanges } from '../audio/audio-silence';
import type { SourceRange } from '../timeline/actions/range-removal';
import { removeSilenceFromItems } from '../timeline/actions/range-removal';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './import.svelte';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { ensureAc3DecoderForCodec } from './ac3-decoder';

export interface RemoveSilenceOptions extends AudioSilenceDetectionOptions {
	/** 'signal' decodes audio; 'speech' derives gaps from the transcript. */
	mode?: 'signal' | 'speech';
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}

export interface SilenceAnalysisResult {
	rangesByMediaId: Record<string, SourceRange[]>;
	analyzedMediaIds: string[];
	failedMediaIds: string[];
}

function abortError(): DOMException {
	return new DOMException('Silence analysis cancelled', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortError();
}

/** Decode only one source-time range into mono channel data for analysis. */
export async function decodeAudioBlobRangeForAnalysis(
	blob: Blob,
	startSeconds = 0,
	endSeconds = Number.POSITIVE_INFINITY,
	signal?: AbortSignal
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	throwIfAborted(signal);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('No audio track');
		await ensureAc3DecoderForCodec(track.codec);
		const duration = await track.computeDuration();
		const start = Math.min(duration, Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0));
		const requestedEnd = Number.isFinite(endSeconds) ? endSeconds : duration;
		const end = Math.min(duration, Math.max(start, requestedEnd));
		const sink = new AudioSampleSink(track);
		let totalFrames = 0;
		let sampleRate = track.sampleRate || 48_000;
		const chunks: Float32Array[] = [];
		for await (const sample of sink.samples(start, end)) {
			try {
				throwIfAborted(signal);
				if (chunks.length > 0 && sample.sampleRate !== sampleRate) {
					throw new Error('Audio sample rate changed during range decoding');
				}
				sampleRate = sample.sampleRate;
				const sampleEnd = sample.timestamp + sample.duration;
				const overlapStart = Math.max(start, sample.timestamp);
				const overlapEnd = Math.min(end, sampleEnd);
				const frameOffset = Math.max(
					0,
					Math.min(
						sample.numberOfFrames,
						Math.ceil((overlapStart - sample.timestamp) * sampleRate - 1e-7)
					)
				);
				const frameEnd = Math.max(
					frameOffset,
					Math.min(
						sample.numberOfFrames,
						Math.ceil((overlapEnd - sample.timestamp) * sampleRate - 1e-7)
					)
				);
				const frames = frameEnd - frameOffset;
				if (frames === 0) continue;
				const merged = new Float32Array(frames);
				for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
					const plane = new Float32Array(frames);
					sample.copyTo(plane, {
						format: 'f32-planar',
						planeIndex: channel,
						frameOffset,
						frameCount: frames
					});
					for (let frame = 0; frame < frames; frame += 1) {
						merged[frame] += (plane[frame] ?? 0) / sample.numberOfChannels;
					}
				}
				chunks.push(merged);
				totalFrames += frames;
			} finally {
				sample.close();
			}
		}
		throwIfAborted(signal);
		const channel = new Float32Array(Math.max(totalFrames, 1));
		let offset = 0;
		for (const chunk of chunks) {
			channel.set(chunk, offset);
			offset += chunk.length;
		}
		return {
			duration: totalFrames / sampleRate,
			length: channel.length,
			numberOfChannels: 1,
			sampleRate,
			getChannelData: () => channel
		};
	} finally {
		input.dispose?.();
	}
}

export async function decodeAudioRangeForAnalysis(
	mediaId: string,
	startSeconds: number,
	endSeconds: number,
	signal?: AbortSignal
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	throwIfAborted(signal);
	const media = mediaPool.get(mediaId);
	if (!media) throw new Error(`Unknown media: ${mediaId}`);
	return decodeAudioBlobRangeForAnalysis(
		await resolveMediaBlob(media),
		startSeconds,
		endSeconds,
		signal
	);
}

/** Decode a media item's full audio into mono channel data for detection. */
export async function decodeAudioForAnalysis(
	mediaId: string,
	signal?: AbortSignal
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	return decodeAudioRangeForAnalysis(mediaId, 0, Number.POSITIVE_INFINITY, signal);
}

function toSourceRanges(ranges: Array<{ start: number; end: number }>): SourceRange[] {
	return ranges.map((r) => ({ start: r.start, end: r.end }));
}

function selectedSpansByMedia(items: readonly TimelineItem[]): Map<string, SourceRange[]> {
	const spans = new Map<string, SourceRange[]>();
	for (const item of items) {
		if (!item.mediaId) continue;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : timelineStore.fps;
		const start = Math.max(0, (item.sourceStart ?? 0) / sourceFps);
		const end = Math.max(
			start,
			(item.sourceEnd ??
				(item.sourceStart ?? 0) +
					(item.durationInFrames * (item.speed ?? 1) * sourceFps) / timelineStore.fps) / sourceFps
		);
		const current = spans.get(item.mediaId) ?? [];
		current.push({ start, end });
		spans.set(item.mediaId, current);
	}
	return spans;
}

function rangesInsideSpans(
	ranges: readonly SourceRange[],
	spans: readonly SourceRange[]
): SourceRange[] {
	const intersections = ranges.flatMap((range) =>
		spans.flatMap((span) => {
			const start = Math.max(range.start, span.start);
			const end = Math.min(range.end, span.end);
			return end > start ? [{ start, end }] : [];
		})
	);
	const merged: SourceRange[] = [];
	for (const range of intersections.toSorted((left, right) => left.start - right.start)) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

/** Analyze selected media without mutating the timeline. */
export async function analyzeSilenceSignal(
	itemIds: string[],
	options: RemoveSilenceOptions = {}
): Promise<SilenceAnalysisResult> {
	const { mode: _mode, signal, onProgress, ...detectorOptions } = options;
	const items = timelineItemsFor(itemIds);
	const spansByMediaId = selectedSpansByMedia(items);
	const mediaIds = [...spansByMediaId.keys()];
	const rangesByMediaId: Record<string, SourceRange[]> = {};
	const analyzedMediaIds: string[] = [];
	const failedMediaIds: string[] = [];
	onProgress?.(mediaIds.length === 0 ? 1 : 0);

	for (let index = 0; index < mediaIds.length; index += 1) {
		throwIfAborted(signal);
		const mediaId = mediaIds[index]!;
		try {
			const buffer = await decodeAudioForAnalysis(mediaId, signal);
			const detected = toSourceRanges(detectSilentRanges(buffer, detectorOptions));
			const visible = rangesInsideSpans(detected, spansByMediaId.get(mediaId) ?? []);
			if (visible.length > 0) rangesByMediaId[mediaId] = visible;
			analyzedMediaIds.push(mediaId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			failedMediaIds.push(mediaId);
		}
		onProgress?.((index + 1) / Math.max(1, mediaIds.length));
	}
	return { rangesByMediaId, analyzedMediaIds, failedMediaIds };
}

/**
 * Detect + remove silence for the given timeline items ('signal' mode).
 * Speech mode arrives with the transcription feature; callers pass ranges
 * directly today.
 */
export async function removeSilenceSignal(
	itemIds: string[],
	options: RemoveSilenceOptions = {}
): Promise<number> {
	const analysis = await analyzeSilenceSignal(itemIds, options);
	const result = removeSilenceFromItems(itemIds, analysis.rangesByMediaId);
	return result.removedItemCount;
}

function timelineItemsFor(ids: string[]): TimelineItem[] {
	return ids
		.map((id) => timelineStore.itemById.get(id))
		.filter((item): item is TimelineItem => item !== undefined);
}
