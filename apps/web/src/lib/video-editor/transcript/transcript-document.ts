import type { SubtitleCue, TimelineItem } from '../project/types';
import {
	captionTimelineOffset,
	captionFramesToSourceRange,
	resolveTranscriptCaptionTiming
} from './caption-source-mapping';
import {
	getItemSourceSpanSeconds,
	sourceSecondsToTimelineFrame
} from '../timeline/utils/media-item-frames';
import { parseSubtitleCueText } from './subtitle-cue-format';
import type { TranscriptSourceWord } from './speech-cleanup';

export interface TranscriptToken {
	id: string;
	itemId: string;
	cueId: string;
	text: string;
	startFrame: number;
	endFrame: number;
	source?: TranscriptSourceWord;
}

export function transcriptDocument(
	items: TimelineItem[],
	fps: number,
	scope?: string[]
): TranscriptToken[] {
	return items
		.filter((item) => item.type === 'subtitle')
		.flatMap((item) => {
			const offset = captionTimelineOffset(item);
			const caption = item.captionSource;
			const sourceItem = caption
				? items.find((candidate) => candidate.id === caption.clipId)
				: undefined;
			const timing =
				caption && (caption.type === 'transcript' || caption.type === 'ai-captions')
					? resolveTranscriptCaptionTiming(caption, sourceItem, fps)
					: undefined;
			const sourceSpan = sourceItem ? getItemSourceSpanSeconds(sourceItem, fps) : null;
			return (item.cues ?? []).flatMap((cue) => {
				const words = cue.words?.length
					? cue.words
					: [
							{
								id: cue.id,
								text: parseSubtitleCueText(cue.text).plainText,
								startFrame: cue.startFrame,
								endFrame: cue.endFrame
							}
						];
				return words
					.map((word): TranscriptToken => {
						const startFrame = Math.max(item.from, word.startFrame + offset);
						const endFrame = Math.min(item.from + item.durationInFrames, word.endFrame + offset);
						let source: TranscriptSourceWord | undefined;
						if (timing && sourceItem?.mediaId && sourceSpan && endFrame > startFrame) {
							const range = captionFramesToSourceRange(
								startFrame - offset,
								endFrame - offset,
								timing,
								fps
							);
							const start = Math.max(sourceSpan.start, range.start);
							const end = Math.min(sourceSpan.end, range.end);
							if (end > start) {
								const first = sourceSecondsToTimelineFrame(sourceItem, start, fps);
								const last = sourceSecondsToTimelineFrame(sourceItem, end, fps);
								source = {
									id: `${sourceItem.id}:${item.id}:${cue.id}:${word.id}`,
									sourceItemId: sourceItem.id,
									mediaId: sourceItem.mediaId,
									subtitleItemId: item.id,
									cueId: cue.id,
									wordId: word.id,
									text: word.text,
									start,
									end,
									timelineStartFrame: Math.min(first, last),
									timelineEndFrame: Math.max(first, last)
								};
							}
						}
						return {
							id: `${item.id}:${cue.id}:${word.id}`,
							itemId: item.id,
							cueId: cue.id,
							text: word.text,
							startFrame,
							endFrame,
							source
						};
					})
					.filter(
						(word) =>
							word.text.trim() &&
							word.endFrame > word.startFrame &&
							(!scope ||
								scope.includes(item.id) ||
								(word.source?.sourceItemId && scope.includes(word.source.sourceItemId)))
					);
			});
		})
		.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}

export function selectedTranscriptCues(
	tokens: TranscriptToken[],
	items: TimelineItem[]
): Array<{ item: TimelineItem; cue: SubtitleCue }> {
	const keys = new Set(tokens.map((token) => `${token.itemId}:${token.cueId}`));
	return items.flatMap((item) =>
		(item.cues ?? [])
			.filter((cue) => keys.has(`${item.id}:${cue.id}`))
			.map((cue) => ({ item, cue }))
	);
}
