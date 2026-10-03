import { recordingAnalysisItemIds } from './recording-review';
import { createDefaultAudioEffect } from '../audio/audio-effects';
import { NOISE_REDUCTION_DEFAULT_AMOUNT } from '../audio/audio-noise-reduction';
import { findLinkedAudioCompanion } from '../audio/transition-crossfade';
import { mediaPool } from '../media/pool.svelte';
import { isTrackEffectivelyLocked } from '../timeline/utils/track-groups';
import { updateItemProperties } from '../timeline/actions/items';
import { removeTranscriptItemRanges, type SourceRange } from '../timeline/actions/range-removal';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import type { TimelineItem } from '../project/types';

interface RecordingCleanupRange extends SourceRange {
	sourceItemId: string;
}

/** Apply finishing choices before splitting so every surviving piece retains its audio treatment. */
export function applyRecordingCleanup(options: {
	itemIds: readonly string[];
	ranges: readonly RecordingCleanupRange[];
	cleanVoice: boolean;
}): { removedCount: number; voiceCount: number } {
	return commandHistory.executeAtomic({ type: 'CLEAN_UP_RECORDING' }, () => {
		let voiceCount = 0;
		const targets = new Set(recordingAnalysisItemIds(timelineStore.items, options.itemIds));
		const audioTargets = new Map<string, TimelineItem>();
		if (options.cleanVoice) {
			for (const id of targets) {
				const item = timelineStore.itemById.get(id);
				if (!item || (item.type !== 'audio' && item.type !== 'video')) continue;
				if (isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) continue;
				if (item.mediaId && mediaPool.get(item.mediaId)?.hasAudio === false) continue;
				const companion = findLinkedAudioCompanion(item, timelineStore.items);
				if (item.type === 'video' && item.audioDetached && !companion) continue;
				const audio = companion ?? item;
				audioTargets.set(audio.id, audio);
			}
			for (const audio of audioTargets.values()) {
				const patch: Partial<TimelineItem> = {};
				if (!audio.audioNoiseReductionEnabled) {
					patch.audioNoiseReductionEnabled = true;
					patch.audioNoiseReductionAmount =
						audio.audioNoiseReductionAmount ?? NOISE_REDUCTION_DEFAULT_AMOUNT;
				}
				if (!audio.audioEffects?.some((effect) => effect.type === 'compressor')) {
					patch.audioEffects = [
						...(audio.audioEffects ?? []),
						createDefaultAudioEffect('compressor')
					];
				}
				if (Object.keys(patch).length && updateItemProperties(audio.id, patch)) voiceCount += 1;
			}
		}
		const ranges: Record<string, SourceRange[]> = {};
		for (const range of options.ranges) {
			if (!targets.has(range.sourceItemId)) continue;
			(ranges[range.sourceItemId] ??= []).push({ start: range.start, end: range.end });
		}
		const result = removeTranscriptItemRanges(ranges);
		return { removedCount: result.removedRangeCount, voiceCount };
	});
}
