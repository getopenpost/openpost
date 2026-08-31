import type {
	AiCaptionsCaptionSource,
	SubtitleCue,
	SubtitleWord,
	TimelineItem,
	TranscriptCaptionSource
} from '../project/types';
import { joinTranscriptWords } from './engine/transcript-text';

function captionSourceForItem(
	item: TimelineItem,
	timelineFps: number,
	type: 'transcript' | 'ai-captions' = 'transcript'
): TranscriptCaptionSource | AiCaptionsCaptionSource {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : timelineFps;
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	const sourceStartSeconds = Math.max(0, (item.sourceStart ?? 0) / sourceFps);
	const sourceEndSeconds = Math.max(
		sourceStartSeconds,
		(item.sourceEnd ??
			(item.sourceStart ?? 0) +
				(item.durationInFrames * speed * sourceFps) / Math.max(1, timelineFps)) / sourceFps
	);
	// SAFETY: type is constrained to the two clip-owned caption sources, and the returned shape satisfies either transcript or ai-captions source.
	return {
		type,
		clipId: item.id,
		mediaId: item.mediaId ?? '',
		sourceStartSeconds,
		sourceEndSeconds,
		playbackSpeed: speed,
		isReversed: item.isReversed === true
	} as TranscriptCaptionSource | AiCaptionsCaptionSource;
}

function slicedWord(
	word: SubtitleWord,
	startFrame: number,
	endFrame: number,
	frameOffset: number,
	newIds: boolean
): SubtitleWord | null {
	if (word.endFrame <= startFrame || word.startFrame >= endFrame) return null;
	return {
		...word,
		id: newIds ? crypto.randomUUID() : word.id,
		startFrame: Math.max(startFrame, word.startFrame) - frameOffset,
		endFrame: Math.max(
			Math.max(startFrame, word.startFrame) - frameOffset + 1,
			Math.min(endFrame, word.endFrame) - frameOffset
		)
	};
}

function slicedCue(
	cue: SubtitleCue,
	startFrame: number,
	endFrame: number,
	frameOffset: number,
	newIds: boolean
): SubtitleCue | null {
	if (cue.endFrame <= startFrame || cue.startFrame >= endFrame) return null;
	const words = cue.words
		?.map((word) => slicedWord(word, startFrame, endFrame, frameOffset, newIds))
		.filter((word): word is SubtitleWord => word !== null);
	if (cue.words && words?.length === 0) return null;
	const cueStart =
		words && words.length > 0
			? Math.min(...words.map((word) => word.startFrame))
			: Math.max(startFrame, cue.startFrame) - frameOffset;
	const cueEnd =
		words && words.length > 0
			? Math.max(...words.map((word) => word.endFrame))
			: Math.min(endFrame, cue.endFrame) - frameOffset;
	return {
		...cue,
		id: newIds ? crypto.randomUUID() : cue.id,
		startFrame: cueStart,
		endFrame: Math.max(cueStart + 1, cueEnd),
		text: words ? joinTranscriptWords(words.map((word) => word.text)) : cue.text,
		words
	};
}

function slicedCues(
	cues: readonly SubtitleCue[],
	startFrame: number,
	endFrame: number,
	frameOffset: number,
	newIds: boolean
): SubtitleCue[] {
	return cues
		.map((cue) => slicedCue(cue, startFrame, endFrame, frameOffset, newIds))
		.filter((cue): cue is SubtitleCue => cue !== null);
}

/** Keep clip-owned transcript and AI captions aligned when their source clip splits. */
export function synchronizeTranscriptCaptionsAfterSplit(
	items: readonly TimelineItem[],
	leftSource: TimelineItem,
	rightSource: TimelineItem,
	splitFrame: number,
	timelineFps: number
): TimelineItem[] {
	const nextItems: TimelineItem[] = [];
	for (const item of items) {
		const sourceType = item.captionSource?.type;
		if (
			item.type !== 'subtitle' ||
			(sourceType !== 'transcript' && sourceType !== 'ai-captions') ||
			item.captionSource.clipId !== leftSource.id ||
			!item.cues
		) {
			nextItems.push(item);
			continue;
		}
		const splitOffset = splitFrame - item.from;
		if (splitOffset <= 0 || splitOffset >= item.durationInFrames) {
			nextItems.push(item);
			continue;
		}
		const leftCues = slicedCues(item.cues, 0, splitOffset, 0, false);
		const rightCues = slicedCues(item.cues, splitOffset, item.durationInFrames, splitOffset, true);
		// SAFETY: guarded above to transcript or ai-captions, so narrowing to those two is sound.
		const captionType = item.captionSource?.type as 'transcript' | 'ai-captions';
		if (leftCues.length > 0) {
			nextItems.push({
				...item,
				durationInFrames: leftSource.durationInFrames,
				captionSource: captionSourceForItem(leftSource, timelineFps, captionType),
				cues: leftCues
			});
		}
		if (rightCues.length > 0) {
			nextItems.push({
				...item,
				id: crypto.randomUUID(),
				from: rightSource.from,
				durationInFrames: rightSource.durationInFrames,
				captionSource: captionSourceForItem(rightSource, timelineFps, captionType),
				cues: rightCues
			});
		}
	}
	return nextItems;
}
