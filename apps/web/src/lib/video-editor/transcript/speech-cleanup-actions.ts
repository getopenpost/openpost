import type { RangeRemovalResult, SourceRange } from '../timeline/actions/range-removal';
import {
	removeFillerWordsFromItems,
	removeSilenceFromItems,
	removeTranscriptItemRanges,
	removeTranscriptRangesFromItems
} from '../timeline/actions/range-removal';
import type { FillerRange, TranscriptSourceWord } from './speech-cleanup';
import type { TranscriptSelectionTargets } from './transcript-edit-model';

export function applyFillerRangeRemoval(
	itemIds: string[],
	ranges: readonly FillerRange[]
): RangeRemovalResult {
	const byMedia: Record<string, SourceRange[]> = {};
	for (const range of ranges)
		(byMedia[range.mediaId] ??= []).push({ start: range.start, end: range.end });
	return removeFillerWordsFromItems(itemIds, byMedia);
}

export function applyTranscriptWordRemoval(
	itemIds: string[],
	words: readonly TranscriptSourceWord[]
): RangeRemovalResult {
	const ranges: Record<string, SourceRange[]> = {};
	for (const word of words)
		(ranges[word.mediaId] ??= []).push({ start: word.start, end: word.end });
	return applyTranscriptRangeRemoval(itemIds, ranges);
}

export function applyTranscriptRangeRemoval(
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeTranscriptRangesFromItems(itemIds, rangesByMediaId);
}

export function applyTranscriptTargetRangeRemoval(
	targets: TranscriptSelectionTargets
): RangeRemovalResult {
	return removeTranscriptItemRanges(
		Object.fromEntries(Object.entries(targets).map(([id, target]) => [id, target.ranges]))
	);
}

export function applySilenceRangeRemoval(
	itemIds: string[],
	rangesByMediaId: Record<string, SourceRange[]>
): RangeRemovalResult {
	return removeSilenceFromItems(itemIds, rangesByMediaId);
}
