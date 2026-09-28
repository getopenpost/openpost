import type { SubtitleCue, SubtitleWord, TimelineItem } from '../project/types';
import { joinTranscriptWords } from './engine/transcript-text';
import {
	captionFramesToSourceRange,
	resolveTranscriptCaptionTiming
} from './caption-source-mapping';

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
	_splitFrame: number,
	timelineFps: number,
	lockedTrackIds: ReadonlySet<string> = new Set()
): TimelineItem[] {
	const nextItems: TimelineItem[] = [];
	for (const item of items) {
		const sourceType = item.captionSource?.type;
		if (
			item.type !== 'subtitle' ||
			lockedTrackIds.has(item.trackId) ||
			(sourceType !== 'transcript' && sourceType !== 'ai-captions') ||
			item.captionSource?.clipId !== leftSource.id ||
			!item.cues
		) {
			nextItems.push(item);
			continue;
		}
		const originalSource = {
			...leftSource,
			durationInFrames: leftSource.durationInFrames + rightSource.durationInFrames,
			sourceStart: Math.min(leftSource.sourceStart ?? 0, rightSource.sourceStart ?? 0),
			sourceEnd: Math.max(leftSource.sourceEnd ?? 0, rightSource.sourceEnd ?? 0)
		};
		const source = item.captionSource;
		if (!source || (source.type !== 'transcript' && source.type !== 'ai-captions')) continue;
		const timing = resolveTranscriptCaptionTiming(source, originalSource, timelineFps);
		for (const fragment of [leftSource, rightSource]) {
			const start = Math.max(item.from, fragment.from);
			const end = Math.min(
				item.from + item.durationInFrames,
				fragment.from + fragment.durationInFrames
			);
			if (end <= start) continue;
			const firstFrame = start - item.from;
			const lastFrame = end - item.from;
			const newIds = fragment.id === rightSource.id;
			const cues = slicedCues(item.cues, firstFrame, lastFrame, firstFrame, newIds);
			if (cues.length === 0) continue;
			const range = captionFramesToSourceRange(firstFrame, lastFrame, timing, timelineFps);
			nextItems.push({
				...item,
				id: newIds ? crypto.randomUUID() : item.id,
				from: start,
				durationInFrames: end - start,
				captionSource: {
					...source,
					clipId: fragment.id,
					sourceStartSeconds: range.start,
					sourceEndSeconds: range.end,
					playbackSpeed: timing.playbackSpeed,
					isReversed: timing.isReversed
				},
				cues
			});
		}
	}
	return nextItems;
}

/** Clip attached captions to the retained window without regenerating corrected words. */
export function trimClipCaptions(
	items: readonly TimelineItem[],
	original: TimelineItem,
	trimmed: TimelineItem,
	fps: number
): TimelineItem[] {
	return items.flatMap((item) => {
		const source = item.captionSource;
		if (!source || source.clipId !== original.id) return [item];
		const start = Math.max(item.from, trimmed.from);
		const end = Math.min(
			item.from + item.durationInFrames,
			trimmed.from + trimmed.durationInFrames
		);
		if (end <= start) return [];
		const offset = start - item.from;
		const cues = item.cues
			? slicedCues(item.cues, offset, end - item.from, offset, false)
			: undefined;
		if (cues?.length === 0) return [];
		let captionSource = source;
		if (source.type === 'transcript' || source.type === 'ai-captions') {
			const timing = resolveTranscriptCaptionTiming(source, original, fps);
			const range = captionFramesToSourceRange(offset, end - item.from, timing, fps);
			captionSource = { ...source, sourceStartSeconds: range.start, sourceEndSeconds: range.end };
		}
		return [{ ...item, from: start, durationInFrames: end - start, cues, captionSource }];
	});
}
