import { intersectQuietRanges } from '../audio/speech-detection';
import { mediaPool } from '../media/pool.svelte';
import { analyzeSilenceSignal } from '../media/silence';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	collectTranscriptSourceWords,
	detectFillerRanges,
	detectTranscriptSilenceRanges,
	FILLER_REMOVAL_PRESETS,
	type FillerRange
} from './speech-cleanup';
import { suggestRetakes, type RetakeSuggestion } from './retake-suggestions';
import {
	protectRecordingRanges,
	recordingAnalysisItemIds,
	recordingReviewFingerprint
} from './recording-review';

interface RecordingReviewRange {
	sourceItemId: string;
	mediaId: string;
	start: number;
	end: number;
	kind: 'pause' | 'filler' | 'retake';
	filler?: FillerRange;
	retake?: RetakeSuggestion;
}

const PAUSE_SETTINGS = {
	minSilenceMs: 900,
	paddingStartMs: 200,
	paddingEndMs: 200
};

/** Analyze conservatively, retaining source instances and all linked audio evidence. */
export async function analyzeRecordingCleanup(
	itemIds: string[],
	options: { signal: AbortSignal; onProgress: (progress: number) => void }
): Promise<{
	ranges: RecordingReviewRange[];
	fingerprint: string;
	analyzedCount: number;
	failedCount: number;
}> {
	const items = timelineStore.items;
	const tracks = timelineStore.tracks;
	const fps = timelineStore.fps;
	const fingerprint = recordingReviewFingerprint(items, tracks, itemIds, fps);
	// Confirmed video-only sources contribute no audio. Unknown sources remain obligations.
	const audioView = items.map((item) =>
		item.mediaId && mediaPool.get(item.mediaId)?.hasAudio === false
			? { ...item, audioDetached: true }
			: item
	);
	const analysisIds = recordingAnalysisItemIds(audioView, itemIds).filter((id) => {
		const item = audioView.find((candidate) => candidate.id === id);
		return item?.mediaId && mediaPool.get(item.mediaId)?.hasAudio !== false;
	});
	const words = collectTranscriptSourceWords(items, analysisIds, fps);
	const settings = FILLER_REMOVAL_PRESETS.find((preset) => preset.id === 'conservative')!.settings;
	const ranges: RecordingReviewRange[] = [];
	let analyzedCount = 0;
	const signalResult = await analyzeSilenceSignal(analysisIds, {
		...PAUSE_SETTINGS,
		mode: 'signal',
		signal: options.signal,
		onProgress: options.onProgress,
		autoThresholds: true,
		minAudioMs: 80,
		smoothingMs: 50,
		windowMs: 20
	});
	for (const sourceItemId of analysisIds) {
		options.signal.throwIfAborted();
		const item = items.find((candidate) => candidate.id === sourceItemId);
		if (!item?.mediaId) continue;
		const mediaId = item.mediaId;
		const itemWords = words.filter((word) => word.sourceItemId === sourceItemId);
		ranges.push(
			...Object.values(detectFillerRanges(itemWords, settings))
				.flat()
				.map(
					(filler): RecordingReviewRange => ({
						sourceItemId,
						mediaId,
						start: filler.start,
						end: filler.end,
						kind: 'filler',
						filler
					})
				)
		);
		ranges.push(
			...suggestRetakes(itemWords).map(
				(retake): RecordingReviewRange => ({
					sourceItemId,
					mediaId,
					start: retake.start,
					end: retake.end,
					kind: 'retake',
					retake
				})
			)
		);
		let pauses = signalResult.rangesByMediaId[mediaId] ?? [];
		if (itemWords.length) {
			// Missing transcript words cannot establish silence, but timed speech can veto a cut.
			pauses = intersectQuietRanges(
				pauses,
				detectTranscriptSilenceRanges(items, [sourceItemId], fps, PAUSE_SETTINGS)[mediaId] ?? []
			);
		}
		ranges.push(
			...pauses.map(
				(range): RecordingReviewRange => ({
					...range,
					sourceItemId,
					mediaId,
					kind: 'pause'
				})
			)
		);
		analyzedCount += 1;
	}
	options.signal.throwIfAborted();
	return {
		ranges: protectRecordingRanges(audioView, tracks, analysisIds, fps, ranges),
		fingerprint,
		analyzedCount,
		failedCount: signalResult.failedMediaIds.length
	};
}
