import type {
	AiCaptionsCaptionSource,
	TimelineItem,
	TranscriptCaptionSource
} from '../project/types';
import type { SourceRange } from '../timeline/actions/range-removal';

export interface ResolvedTranscriptCaptionTiming {
	sourceStartSeconds: number;
	sourceEndSeconds: number;
	playbackSpeed: number;
	isReversed: boolean;
}

export interface CaptionFrameRange {
	start: number;
	end: number;
}

/** Generated cues use clip-local frames; imported subtitle files use sequence frames. */
export function captionTimelineOffset(item: TimelineItem): number {
	return item.captionSource?.type === 'transcript' || item.captionSource?.type === 'ai-captions'
		? item.from
		: 0;
}

export function resolveTranscriptCaptionTiming(
	source: TranscriptCaptionSource | AiCaptionsCaptionSource,
	sourceItem: TimelineItem | null | undefined,
	timelineFps: number
): ResolvedTranscriptCaptionTiming {
	const sourceFps =
		sourceItem?.sourceFps && sourceItem.sourceFps > 0 ? sourceItem.sourceFps : timelineFps;
	const sourceStartSeconds =
		source.sourceStartSeconds ?? Math.max(0, (sourceItem?.sourceStart ?? 0) / sourceFps);
	const playbackSpeed =
		source.playbackSpeed && source.playbackSpeed > 0
			? source.playbackSpeed
			: sourceItem?.speed && sourceItem.speed > 0
				? sourceItem.speed
				: 1;
	const derivedEnd =
		sourceStartSeconds +
		((sourceItem?.durationInFrames ?? 0) * playbackSpeed) / Math.max(1, timelineFps);
	const sourceEndSeconds = Math.max(
		sourceStartSeconds,
		source.sourceEndSeconds ??
			(sourceItem?.sourceEnd == null ? derivedEnd : sourceItem.sourceEnd / sourceFps)
	);
	return {
		sourceStartSeconds,
		sourceEndSeconds,
		playbackSpeed,
		isReversed: source.isReversed ?? sourceItem?.isReversed === true
	};
}

export function captionFramesToSourceRange(
	startFrame: number,
	endFrame: number,
	timing: ResolvedTranscriptCaptionTiming,
	timelineFps: number
): SourceRange {
	if (timing.isReversed) {
		return {
			start: timing.sourceEndSeconds - (endFrame * timing.playbackSpeed) / Math.max(1, timelineFps),
			end: timing.sourceEndSeconds - (startFrame * timing.playbackSpeed) / Math.max(1, timelineFps)
		};
	}
	return {
		start:
			timing.sourceStartSeconds + (startFrame * timing.playbackSpeed) / Math.max(1, timelineFps),
		end: timing.sourceStartSeconds + (endFrame * timing.playbackSpeed) / Math.max(1, timelineFps)
	};
}

export function sourceRangeToCaptionFrames(
	range: SourceRange,
	timing: ResolvedTranscriptCaptionTiming,
	timelineFps: number,
	durationInFrames: number
): CaptionFrameRange {
	const first = timing.isReversed
		? ((timing.sourceEndSeconds - range.end) * timelineFps) / timing.playbackSpeed
		: ((range.start - timing.sourceStartSeconds) * timelineFps) / timing.playbackSpeed;
	const second = timing.isReversed
		? ((timing.sourceEndSeconds - range.start) * timelineFps) / timing.playbackSpeed
		: ((range.end - timing.sourceStartSeconds) * timelineFps) / timing.playbackSpeed;
	return {
		start: Math.max(0, Math.min(durationInFrames, Math.round(Math.min(first, second)))),
		end: Math.max(0, Math.min(durationInFrames, Math.round(Math.max(first, second))))
	};
}
