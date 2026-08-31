import { describe, expect, it } from 'vitest';
import type { TranscriptSourceWord } from './speech-cleanup';
import {
	buildTranscriptSelectionRanges,
	findActiveTranscriptWordIndex,
	getSelectedTranscriptWordSlice
} from './transcript-edit-model';

function word(id: string, start: number, end: number): TranscriptSourceWord {
	return {
		id,
		mediaId: 'media',
		subtitleItemId: 'captions',
		cueId: 'cue',
		wordId: id,
		text: id,
		sourceItemId: 'source',
		start: start / 30,
		end: end / 30,
		timelineStartFrame: start,
		timelineEndFrame: end
	};
}

describe('transcript edit model', () => {
	const words = [word('one', 0, 10), word('two', 12, 20), word('three', 22, 30)];

	it('returns a contiguous selection in document order in either direction', () => {
		expect(getSelectedTranscriptWordSlice(words, 0, 2).map((entry) => entry.id)).toEqual([
			'one',
			'two',
			'three'
		]);
		expect(getSelectedTranscriptWordSlice(words, 2, 1).map((entry) => entry.id)).toEqual([
			'two',
			'three'
		]);
		expect(getSelectedTranscriptWordSlice(words, -1, 1)).toEqual([]);
	});

	it('finds only the word whose half-open timeline span owns the playhead', () => {
		expect(findActiveTranscriptWordIndex(words, 0)).toBe(0);
		expect(findActiveTranscriptWordIndex(words, 10)).toBe(-1);
		expect(findActiveTranscriptWordIndex(words, 19)).toBe(1);
		expect(findActiveTranscriptWordIndex(words, 30)).toBe(-1);
	});

	it('turns each selected clip run into one source range including word gaps', () => {
		expect(buildTranscriptSelectionRanges(words)).toEqual({
			source: { mediaId: 'media', ranges: [{ start: 0, end: 1 }] }
		});
		const secondClip = { ...words[2]!, id: 'other', sourceItemId: 'other', start: 2, end: 3 };
		expect(buildTranscriptSelectionRanges([words[0]!, words[1]!, secondClip])).toEqual({
			source: { mediaId: 'media', ranges: [{ start: 0, end: 2 / 3 }] },
			other: { mediaId: 'media', ranges: [{ start: 2, end: 3 }] }
		});
	});

	it('covers the full descending source span of a reversed clip run', () => {
		const reversed = [
			{ ...word('later-source', 0, 10), start: 2, end: 3 },
			{ ...word('earlier-source', 12, 20), start: 1, end: 2 }
		];
		expect(buildTranscriptSelectionRanges(reversed)).toEqual({
			source: { mediaId: 'media', ranges: [{ start: 1, end: 3 }] }
		});
	});
});
