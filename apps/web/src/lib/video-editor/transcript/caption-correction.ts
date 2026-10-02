import type { SubtitleCue, SubtitleWord, TimelineItem } from '../project/types';
import { captionTimelineOffset, type CaptionFrameRange } from './caption-source-mapping';
import { buildCueText, getCueFormatFlags, parseSubtitleCueText } from './subtitle-cue-format';

export function captionTimingBounds(item: TimelineItem): CaptionFrameRange {
	const start = item.from - captionTimelineOffset(item);
	return { start, end: start + item.durationInFrames };
}

function validTiming(start: number, end: number, bounds: CaptionFrameRange): boolean {
	return (
		Number.isInteger(start) &&
		Number.isInteger(end) &&
		start >= bounds.start &&
		end <= bounds.end &&
		end > start
	);
}

export interface CorrectedCueTimingPatch {
	startFrame: number;
	endFrame: number;
	words?: SubtitleWord[];
}

/** Move and scale timed words with their cue so no word survives outside it. */
export function correctedCueTimingPatch(
	cue: SubtitleCue,
	startFrame: number,
	endFrame: number,
	bounds: CaptionFrameRange
): CorrectedCueTimingPatch | null {
	if (!validTiming(startFrame, endFrame, bounds)) return null;
	const corrected = { startFrame, endFrame };
	if (!cue.words) return corrected;
	const previousDuration = Math.max(1, cue.endFrame - cue.startFrame);
	const nextDuration = corrected.endFrame - corrected.startFrame;
	const mapFrame = (frame: number) => {
		const progress = Math.max(0, Math.min(1, (frame - cue.startFrame) / previousDuration));
		return Math.round(corrected.startFrame + progress * nextDuration);
	};
	const words = cue.words.map((word) => {
		const start = Math.min(corrected.endFrame - 1, mapFrame(word.startFrame));
		const end = Math.max(start + 1, Math.min(corrected.endFrame, mapFrame(word.endFrame)));
		return { ...word, startFrame: start, endFrame: end };
	});
	return { ...corrected, words };
}

export interface CorrectedWordPatch {
	words: SubtitleWord[];
	startFrame: number;
	endFrame: number;
}

function correctionTokens(plainText: string): string[] {
	const trimmed = plainText.trim();
	return trimmed ? trimmed.split(/\s+/) : [];
}

/**
 * Keep cue-level caption corrections and timed transcript words in sync.
 * Existing word identity and timing survive copy-only corrections. A changed
 * word count is spread over the previous timed span so transcript editing does
 * not keep stale or untimed copy.
 */
export function correctedCueWords(cue: SubtitleCue, plainText: string): SubtitleWord[] | undefined {
	if (!cue.words?.length) return undefined;
	const tokens = correctionTokens(plainText);
	if (tokens.length === 0) return undefined;
	if (tokens.length === cue.words.length) {
		return cue.words.map((word, index) => ({ ...word, text: tokens[index]! }));
	}

	const spanStart = Math.min(...cue.words.map((word) => word.startFrame));
	const spanEnd = Math.max(spanStart + 1, ...cue.words.map((word) => word.endFrame));
	const span = spanEnd - spanStart;
	return tokens.map((text, index) => {
		const startFrame = Math.min(
			spanEnd - 1,
			Math.round(spanStart + (span * index) / tokens.length)
		);
		const endFrame = Math.max(
			startFrame + 1,
			Math.min(spanEnd, Math.round(spanStart + (span * (index + 1)) / tokens.length))
		);
		return {
			id: cue.words?.[index]?.id ?? crypto.randomUUID(),
			startFrame,
			endFrame,
			text
		};
	});
}

/**
 * Apply one word correction without allowing NaN or an inverted word interval
 * into persisted captions. Cue bounds follow the complete corrected word set.
 */
export function correctedSubtitleWord(
	cue: SubtitleCue,
	wordId: string,
	patch: Partial<SubtitleWord>,
	bounds: CaptionFrameRange
): CorrectedWordPatch | null {
	if (!cue.words) return null;
	const index = cue.words.findIndex((word) => word.id === wordId);
	if (index < 0) return null;
	const current = cue.words[index]!;
	const startFrame = patch.startFrame ?? current.startFrame;
	const endFrame = patch.endFrame ?? current.endFrame;
	if (
		(patch.startFrame !== undefined || patch.endFrame !== undefined) &&
		!validTiming(startFrame, endFrame, bounds)
	)
		return null;
	const text = patch.text ?? current.text;
	if (text === current.text && startFrame === current.startFrame && endFrame === current.endFrame) {
		return null;
	}

	const words = cue.words.map((word, wordIndex) =>
		wordIndex === index ? { ...word, text, startFrame, endFrame } : { ...word }
	);
	return {
		words,
		startFrame: Math.min(...words.map((word) => word.startFrame)),
		endFrame: Math.max(...words.map((word) => word.endFrame))
	};
}

/** Keep authored separators when timed word copy changes independently of cue layout. */
export function correctedCueWordText(cue: SubtitleCue, words: SubtitleWord[]): string {
	const original = cue.words ?? [];
	if (
		original.length === words.length &&
		original.every(
			(word, index) => word.id === words[index]?.id && word.text === words[index]?.text
		)
	)
		return cue.text;
	const parsed = parseSubtitleCueText(cue.text);
	const plain = parsed.spans.map((span) => span.text).join('');
	const replacements = new Map(words.map((word) => [word.id, word.text]));
	let cursor = 0;
	let text = '';
	let aligned = true;
	for (const word of original) {
		const separator = plain.slice(cursor).match(/^\s*/u)![0];
		text += separator;
		cursor += separator.length;
		if (
			!plain.startsWith(word.text, cursor) ||
			(cursor + word.text.length < plain.length &&
				!/^\s/u.test(plain.slice(cursor + word.text.length)))
		) {
			aligned = false;
			break;
		}
		text += replacements.get(word.id) ?? '';
		cursor += word.text.length;
	}
	if (aligned && /^\s*$/u.test(plain.slice(cursor))) text += plain.slice(cursor);
	else text = words.map((word) => word.text).join(' ');
	return buildCueText(text, getCueFormatFlags(parsed), cue.text);
}
