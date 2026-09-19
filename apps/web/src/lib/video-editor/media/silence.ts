/**
 * Silence removal flow: decode a clip's audio via mediabunny, run the
 * windowed-RMS detector, then apply the shared range-removal machinery as
 * one undo step.
 */

import type { AudioSilenceDetectionOptions } from '../audio/audio-silence';
import type { SourceRange } from '../timeline/actions/range-removal';
import { removeSilenceFromItems } from '../timeline/actions/range-removal';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './import.svelte';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { decodeAudioBlobRangeForAnalysis } from '../audio/analysis-decoder';
export { decodeAudioBlobRangeForAnalysis } from '../audio/analysis-decoder';
import { analyzeAudioBlob } from '../audio/analysis-client';

export interface RemoveSilenceOptions extends AudioSilenceDetectionOptions {
	/** Speech uses a local voice activity model; signal uses audio levels. */
	mode?: 'signal' | 'speech';
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}

export interface SilenceAnalysisResult {
	rangesByMediaId: Record<string, SourceRange[]>;
	analyzedMediaIds: string[];
	failedMediaIds: string[];
}

export async function decodeAudioRangeForAnalysis(
	mediaId: string,
	startSeconds: number,
	endSeconds: number,
	signal?: AbortSignal
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	signal?.throwIfAborted();
	const media = mediaPool.get(mediaId);
	if (!media) throw new Error(`Unknown media: ${mediaId}`);
	return decodeAudioBlobRangeForAnalysis(
		await resolveMediaBlob(media),
		startSeconds,
		endSeconds,
		signal
	);
}

/** Decode a media item's full audio with separate channels for detection. */
export async function decodeAudioForAnalysis(
	mediaId: string,
	signal?: AbortSignal
): Promise<import('../audio/audio-silence').AudioBufferLike> {
	return decodeAudioRangeForAnalysis(mediaId, 0, Number.POSITIVE_INFINITY, signal);
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
	const { mode = 'signal', signal, onProgress, ...detectorOptions } = options;
	const items = timelineItemsFor(itemIds);
	const spansByMediaId = selectedSpansByMedia(items);
	const mediaIds = [...spansByMediaId.keys()];
	const rangesByMediaId: Record<string, SourceRange[]> = {};
	const analyzedMediaIds: string[] = [];
	const failedMediaIds: string[] = [];
	onProgress?.(mediaIds.length === 0 ? 1 : 0);

	for (let index = 0; index < mediaIds.length; index += 1) {
		signal?.throwIfAborted();
		const mediaId = mediaIds[index]!;
		try {
			const media = mediaPool.get(mediaId);
			if (!media) throw new Error(`Unknown media: ${mediaId}`);
			const detected = await analyzeAudioBlob(await resolveMediaBlob(media), {
				...detectorOptions,
				mode,
				signal,
				onProgress: (value) => onProgress?.((index + value) / mediaIds.length)
			});
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

/** Analyze and remove the selected audio ranges as one undo step. */
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
