import type { TranscriptSourceWord } from './speech-cleanup';
import type { SourceRange } from '../timeline/actions/range-removal';

export interface TranscriptSelectionTarget {
	mediaId: string;
	ranges: SourceRange[];
}

export interface TranscriptSelectionTargets {
	[sourceItemId: string]: TranscriptSelectionTarget;
}

export function getSelectedTranscriptWordSlice(
	words: readonly TranscriptSourceWord[],
	anchorIndex: number,
	focusIndex: number
): TranscriptSourceWord[] {
	if (anchorIndex < 0 || focusIndex < 0) return [];
	const start = Math.min(anchorIndex, focusIndex);
	const end = Math.max(anchorIndex, focusIndex);
	return words.slice(start, end + 1);
}

export function findActiveTranscriptWordIndex(
	words: readonly TranscriptSourceWord[],
	currentFrame: number
): number {
	return words.findIndex(
		(word) =>
			word.timelineStartFrame !== undefined &&
			word.timelineEndFrame !== undefined &&
			currentFrame >= word.timelineStartFrame &&
			currentFrame < word.timelineEndFrame
	);
}

export function buildTranscriptSelectionRanges(
	words: readonly TranscriptSourceWord[]
): TranscriptSelectionTargets {
	const targets: TranscriptSelectionTargets = {};
	let runSourceItemId: string | undefined;
	let runMediaId = '';
	let runStart = 0;
	let runEnd = 0;
	const flush = () => {
		if (!runSourceItemId || !runMediaId || runEnd <= runStart) return;
		const target = (targets[runSourceItemId] ??= { mediaId: runMediaId, ranges: [] });
		target.ranges.push({ start: runStart, end: runEnd });
		runMediaId = '';
	};
	for (const word of words) {
		if (!word.sourceItemId) continue;
		if (runMediaId === word.mediaId && runSourceItemId === word.sourceItemId) {
			runStart = Math.min(runStart, word.start);
			runEnd = Math.max(runEnd, word.end);
			continue;
		}
		flush();
		runSourceItemId = word.sourceItemId;
		runMediaId = word.mediaId;
		runStart = word.start;
		runEnd = word.end;
	}
	flush();
	return targets;
}
