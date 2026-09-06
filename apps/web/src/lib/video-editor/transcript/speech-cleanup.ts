import type { SubtitleCue, TimelineItem } from '../project/types';
import type { SourceRange } from '../timeline/actions/range-removal';
import {
	getItemSourceSpanSeconds,
	sourceSecondsToTimelineFrame
} from '../timeline/utils/media-item-frames';
import {
	captionFramesToSourceRange,
	resolveTranscriptCaptionTiming
} from './caption-source-mapping';
import { buildCueText, getCueFormatFlags, parseSubtitleCueText } from './subtitle-cue-format';

const SIMPLE_FILLERS = [
	'ah',
	'eh',
	'em',
	'erm',
	'er',
	'hm',
	'hmm',
	'mhm',
	'mm',
	'mmm',
	'uh',
	'uhh',
	'um',
	'uhm',
	'umm'
] as const;

const PHRASE_FILLERS = ['you know', 'i mean', 'kind of', 'sort of', 'you see'] as const;

export const SUGGESTED_FILLER_WORDS = [
	'actually',
	'basically',
	'like',
	'literally',
	'ok',
	'okay',
	'right',
	'so',
	'well'
] as const;

export interface FillerRemovalSettings {
	fillerWords: string[];
	fillerPhrases: string[];
	paddingMs: number;
	maxSimpleFillerMs: number;
	maxPhraseFillerMs: number;
}

export type FillerRemovalPresetId = 'conservative' | 'balanced' | 'aggressive';

export const DEFAULT_FILLER_REMOVAL_SETTINGS: FillerRemovalSettings = {
	fillerWords: [...SIMPLE_FILLERS],
	fillerPhrases: [...PHRASE_FILLERS],
	paddingMs: 35,
	maxSimpleFillerMs: 1400,
	maxPhraseFillerMs: 1800
};

export const FILLER_REMOVAL_PRESETS: Array<{
	id: FillerRemovalPresetId;
	settings: FillerRemovalSettings;
}> = [
	{
		id: 'conservative',
		settings: {
			fillerWords: [...SIMPLE_FILLERS],
			fillerPhrases: ['you know', 'i mean'],
			paddingMs: 20,
			maxSimpleFillerMs: 900,
			maxPhraseFillerMs: 1300
		}
	},
	{ id: 'balanced', settings: DEFAULT_FILLER_REMOVAL_SETTINGS },
	{
		id: 'aggressive',
		settings: {
			fillerWords: [...SIMPLE_FILLERS, ...SUGGESTED_FILLER_WORDS],
			fillerPhrases: [...PHRASE_FILLERS, 'you know what i mean', 'i guess', 'or whatever'],
			paddingMs: 70,
			maxSimpleFillerMs: 1600,
			maxPhraseFillerMs: 2400
		}
	}
];

export interface TranscriptSourceWord {
	id: string;
	mediaId: string;
	sourceItemId?: string;
	subtitleItemId: string;
	cueId: string;
	wordId: string;
	text: string;
	start: number;
	end: number;
	timelineStartFrame?: number;
	timelineEndFrame?: number;
}

export interface FillerRange extends SourceRange {
	id: string;
	mediaId: string;
	text: string;
	words: TranscriptSourceWord[];
	audioConfidence?: FillerAudioConfidence;
}

export interface FillerAudioConfidence {
	level: 'high' | 'medium' | 'low' | 'unknown';
	fillerScore: number;
	nonFillerScore: number;
	label: string;
}

export type FillerRangesByMediaId = Record<string, FillerRange[]>;

function normalizeWord(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function canonicalFillerWord(text: string): string {
	const normalized = normalizeWord(text);
	if (/^u+h+$/.test(normalized)) return 'uh';
	if (/^u+m+$/.test(normalized)) return 'um';
	if (/^u+h+m+$/.test(normalized)) return 'uhm';
	if (/^a+h+$/.test(normalized)) return 'ah';
	if (/^h+m+$/.test(normalized)) return 'hmm';
	if (/^m+$/.test(normalized)) return normalized.length > 1 ? 'mm' : 'm';
	return normalized;
}

function normalizePhrase(text: string): string[] {
	return text.split(/\s+/).map(normalizeWord).filter(Boolean);
}

function sourceItemForCaption(items: readonly TimelineItem[], clipId: string): TimelineItem | null {
	return (
		items.find((item) => item.id === clipId) ??
		items.find((item) => item.originId === clipId) ??
		null
	);
}

function selectedMediaSpans(
	items: readonly TimelineItem[],
	itemIds: readonly string[],
	timelineFps: number
): Map<string, SourceRange[]> {
	const selected = new Set(itemIds);
	const spans = new Map<string, SourceRange[]>();
	for (const item of items) {
		if (!selected.has(item.id) || (item.type !== 'video' && item.type !== 'audio') || !item.mediaId)
			continue;
		const span = getItemSourceSpanSeconds(item, timelineFps);
		if (!span) continue;
		const current = spans.get(item.mediaId) ?? [];
		current.push(span);
		spans.set(item.mediaId, current);
	}
	return spans;
}

function selectedMediaItems(
	items: readonly TimelineItem[],
	itemIds: readonly string[]
): Map<string, TimelineItem[]> {
	const selected = new Set(itemIds);
	const byMediaId = new Map<string, TimelineItem[]>();
	for (const item of items) {
		if (!selected.has(item.id) || (item.type !== 'video' && item.type !== 'audio') || !item.mediaId)
			continue;
		const candidates = byMediaId.get(item.mediaId) ?? [];
		candidates.push(item);
		byMediaId.set(item.mediaId, candidates);
	}
	for (const candidates of byMediaId.values()) {
		candidates.sort(
			(left, right) => Number(left.type !== 'video') - Number(right.type !== 'video')
		);
	}
	return byMediaId;
}

function overlapsSelectedSpan(word: SourceRange, spans: readonly SourceRange[]): boolean {
	return spans.some((span) => word.start < span.end && word.end > span.start);
}

/** Resolve caption-relative word frames back to stable source-media seconds. */
export function collectTranscriptSourceWords(
	items: readonly TimelineItem[],
	itemIds: readonly string[],
	timelineFps: number
): TranscriptSourceWord[] {
	const selectedItemsByMediaId = selectedMediaItems(items, itemIds);
	if (selectedItemsByMediaId.size === 0) return [];
	const words: TranscriptSourceWord[] = [];
	const seen = new Set<string>();

	for (const subtitle of items) {
		const captionSource = subtitle.captionSource;
		if (
			subtitle.type !== 'subtitle' ||
			captionSource?.type !== 'transcript' ||
			!selectedItemsByMediaId.has(captionSource.mediaId)
		)
			continue;
		const source = sourceItemForCaption(items, captionSource.clipId);
		const timing = resolveTranscriptCaptionTiming(captionSource, source, timelineFps);

		for (const cue of subtitle.cues ?? []) {
			for (const word of cue.words ?? []) {
				const { start, end } = captionFramesToSourceRange(
					word.startFrame,
					word.endFrame,
					timing,
					timelineFps
				);
				if (end <= start) continue;
				for (const selectedItem of selectedItemsByMediaId.get(captionSource.mediaId) ?? []) {
					const span = getItemSourceSpanSeconds(selectedItem, timelineFps);
					if (!span || !overlapsSelectedSpan({ start, end }, [span])) continue;
					const firstBoundary = sourceSecondsToTimelineFrame(selectedItem, start, timelineFps);
					const secondBoundary = sourceSecondsToTimelineFrame(selectedItem, end, timelineFps);
					const timelineStartFrame = Math.min(firstBoundary, secondBoundary);
					const timelineEndFrame = Math.max(
						timelineStartFrame + 1,
						Math.max(firstBoundary, secondBoundary)
					);
					const key = `${captionSource.mediaId}:${timelineStartFrame}:${timelineEndFrame}:${normalizeWord(word.text)}`;
					if (seen.has(key)) continue;
					seen.add(key);
					words.push({
						id: `${selectedItem.id}:${subtitle.id}:${cue.id}:${word.id}`,
						mediaId: captionSource.mediaId,
						sourceItemId: selectedItem.id,
						subtitleItemId: subtitle.id,
						cueId: cue.id,
						wordId: word.id,
						text: word.text,
						start,
						end,
						timelineStartFrame,
						timelineEndFrame
					});
				}
			}
		}
	}

	return words.toSorted(
		(left, right) =>
			(left.timelineStartFrame ?? 0) - (right.timelineStartFrame ?? 0) ||
			(left.timelineEndFrame ?? 0) - (right.timelineEndFrame ?? 0) ||
			left.start - right.start
	);
}

function phraseMatchLength(
	words: readonly TranscriptSourceWord[],
	index: number,
	normalizedWords: readonly string[],
	phrases: readonly string[][],
	maxDurationMs: number
): number {
	for (const phrase of phrases) {
		if (index + phrase.length > words.length) continue;
		if (!phrase.every((part, offset) => normalizedWords[index + offset] === part)) continue;
		const first = words[index];
		const last = words[index + phrase.length - 1];
		if (!first || !last || first.mediaId !== last.mediaId) continue;
		if ((last.end - first.start) * 1000 <= maxDurationMs) return phrase.length;
	}
	return 0;
}

function mergeCloseRanges(ranges: readonly FillerRange[]): FillerRange[] {
	const merged: FillerRange[] = [];
	for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
		const previous = merged.at(-1);
		if (previous && previous.mediaId === range.mediaId && range.start - previous.end <= 0.08) {
			previous.end = Math.max(previous.end, range.end);
			previous.text = `${previous.text} ${range.text}`.trim();
			previous.words.push(...range.words);
			continue;
		}
		merged.push({ ...range, words: [...range.words] });
	}
	return merged;
}

export function detectFillerRanges(
	words: readonly TranscriptSourceWord[],
	settings: FillerRemovalSettings = DEFAULT_FILLER_REMOVAL_SETTINGS
) {
	const fillerWords = new Set(settings.fillerWords.map(canonicalFillerWord).filter(Boolean));
	const fillerPhrases = settings.fillerPhrases
		.map(normalizePhrase)
		.filter((phrase) => phrase.length > 0)
		.toSorted((left, right) => right.length - left.length);
	const padding = Math.max(0, settings.paddingMs) / 1000;
	const byMedia = new Map<string, TranscriptSourceWord[]>();
	for (const word of words) {
		const current = byMedia.get(word.mediaId) ?? [];
		current.push(word);
		byMedia.set(word.mediaId, current);
	}
	const result: FillerRangesByMediaId = {};

	for (const [mediaId, mediaWords] of byMedia) {
		const normalized = mediaWords.map((word) => canonicalFillerWord(word.text));
		const ranges: FillerRange[] = [];
		for (let index = 0; index < mediaWords.length; index += 1) {
			const word = mediaWords[index];
			if (!word) continue;
			if (
				fillerWords.has(normalized[index] ?? '') &&
				(word.end - word.start) * 1000 <= Math.max(0, settings.maxSimpleFillerMs)
			) {
				ranges.push({
					id: word.id,
					mediaId,
					start: Math.max(0, word.start - padding),
					end: word.end + padding,
					text: word.text.trim(),
					words: [word]
				});
				continue;
			}
			const length = phraseMatchLength(
				mediaWords,
				index,
				normalized,
				fillerPhrases,
				Math.max(0, settings.maxPhraseFillerMs)
			);
			if (length === 0) continue;
			const matched = mediaWords.slice(index, index + length);
			const first = matched[0];
			const last = matched.at(-1);
			if (!first || !last) continue;
			ranges.push({
				id: matched.map((candidate) => candidate.id).join('+'),
				mediaId,
				start: Math.max(0, first.start - padding),
				end: last.end + padding,
				text: matched.map((candidate) => candidate.text.trim()).join(' '),
				words: matched
			});
			index += length - 1;
		}
		const merged = mergeCloseRanges(ranges);
		if (merged.length > 0) result[mediaId] = merged;
	}
	return result;
}

export interface TranscriptSilenceSettings {
	minSilenceMs: number;
	paddingStartMs: number;
	paddingEndMs: number;
}

function mergedRanges(ranges: readonly SourceRange[], joinGapSeconds = 0): SourceRange[] {
	const merged: SourceRange[] = [];
	for (const range of ranges.toSorted((left, right) => left.start - right.start)) {
		if (range.end <= range.start) continue;
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end + joinGapSeconds)
			previous.end = Math.max(previous.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

/** Find transcript gaps inside the selected source windows without touching the timeline. */
export function detectTranscriptSilenceRanges(
	items: readonly TimelineItem[],
	itemIds: readonly string[],
	timelineFps: number,
	settings: TranscriptSilenceSettings
) {
	const spansByMediaId = selectedMediaSpans(items, itemIds, timelineFps);
	const words = collectTranscriptSourceWords(items, itemIds, timelineFps);
	const wordsByMediaId = new Map<string, SourceRange[]>();
	for (const word of words) {
		const ranges = wordsByMediaId.get(word.mediaId) ?? [];
		ranges.push({ start: word.start, end: word.end });
		wordsByMediaId.set(word.mediaId, ranges);
	}
	const minSilence = Math.max(0, settings.minSilenceMs) / 1000;
	const keepAfterSpeech = Math.max(0, settings.paddingStartMs) / 1000;
	const keepBeforeSpeech = Math.max(0, settings.paddingEndMs) / 1000;
	const result: Record<string, SourceRange[]> = {};

	for (const [mediaId, spans] of spansByMediaId) {
		const speech = mergedRanges(wordsByMediaId.get(mediaId) ?? [], 0.04);
		// No timed speech for a media file is not evidence that all of it is silent.
		if (speech.length === 0) continue;
		const gaps: SourceRange[] = [];
		for (const span of spans) {
			const overlapping = speech.filter(
				(range) => range.end > span.start && range.start < span.end
			);
			let cursor = span.start;
			for (const spoken of overlapping) {
				const start = cursor + keepAfterSpeech;
				const end = Math.min(span.end, spoken.start) - keepBeforeSpeech;
				if (end - start >= minSilence) gaps.push({ start, end });
				cursor = Math.max(cursor, spoken.end);
			}
			const trailingStart = cursor + keepAfterSpeech;
			const trailingEnd = span.end - keepBeforeSpeech;
			if (trailingEnd - trailingStart >= minSilence)
				gaps.push({ start: trailingStart, end: trailingEnd });
		}
		const merged = mergedRanges(gaps);
		if (merged.length > 0) result[mediaId] = merged;
	}
	return result;
}

export function cueWithoutWords(
	cue: SubtitleCue,
	removedWordIds: ReadonlySet<string>
): SubtitleCue | null {
	const words = cue.words?.filter((word) => !removedWordIds.has(word.id));
	if (!words || words.length === 0) return null;
	return {
		...cue,
		words,
		text: buildCueText(
			words.map((word) => word.text).join(' '),
			getCueFormatFlags(parseSubtitleCueText(cue.text)),
			cue.text
		),
		startFrame: words[0]!.startFrame,
		endFrame: words.at(-1)!.endFrame
	};
}
