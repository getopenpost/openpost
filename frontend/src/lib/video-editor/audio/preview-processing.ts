import type { TimelineItem, TimelineTrack } from '../project/types';
import type { AudioEqSettings } from './types';
import { appendResolvedAudioEqSources, getAudioEqSettings, isAudioEqStageActive } from './audio-eq';
import { getAudioPitchShiftSemitones, isAudioPitchShiftActive } from './audio-pitch';
import { getAudioEffects, hasActiveAudioEffects } from './audio-effects';

export function previewAudioEqStages(
	item: TimelineItem,
	trackAudioEq?: AudioEqSettings | null,
	busAudioEq?: AudioEqSettings | null
) {
	return appendResolvedAudioEqSources(
		undefined,
		busAudioEq,
		trackAudioEq,
		getAudioEqSettings(item)
	);
}

export function previewAudioEqStagesForTimeline(
	item: TimelineItem,
	tracks: readonly TimelineTrack[],
	busAudioEq?: AudioEqSettings | null
) {
	return previewAudioEqStages(item, trackAudioEqForItem(item, tracks), busAudioEq);
}

export function trackAudioEqForItem(
	item: TimelineItem,
	tracks: readonly TimelineTrack[]
): AudioEqSettings | undefined {
	return tracks.find((track) => track.id === item.trackId)?.audioEq;
}

/** Native media playback cannot preserve pitch while changing clip tempo. */
export function requiresProcessedPreviewAudio(
	item: TimelineItem,
	trackAudioEq?: AudioEqSettings | null,
	busAudioEq?: AudioEqSettings | null
): boolean {
	return (
		Math.abs((item.speed ?? 1) - 1) > 0.0001 ||
		isAudioPitchShiftActive(getAudioPitchShiftSemitones(item)) ||
		previewAudioEqStages(item, trackAudioEq, busAudioEq).some(isAudioEqStageActive) ||
		hasActiveAudioEffects(getAudioEffects(item))
	);
}

export function requiresProcessedPreviewAudioForTimeline(
	item: TimelineItem,
	tracks: readonly TimelineTrack[],
	busAudioEq?: AudioEqSettings | null
): boolean {
	return requiresProcessedPreviewAudio(item, trackAudioEqForItem(item, tracks), busAudioEq);
}
