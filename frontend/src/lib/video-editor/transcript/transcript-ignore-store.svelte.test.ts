import { beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptSourceWord } from './speech-cleanup';
import {
	isTranscriptWordIgnored,
	normalizeTranscriptIgnoreRanges,
	subtractTranscriptIgnoreRanges,
	transcriptIgnoreStore
} from './transcript-ignore-store.svelte';

function word(id: string, start: number, end: number): TranscriptSourceWord {
	return {
		id,
		mediaId: 'media',
		subtitleItemId: 'captions',
		cueId: 'cue',
		wordId: id,
		text: id,
		sourceItemId: 'source',
		start,
		end
	};
}

beforeEach(() => transcriptIgnoreStore.__resetForTesting());

describe('transcript ignore ranges', () => {
	it('normalizes, merges, and subtracts stable source-time spans', () => {
		expect(
			normalizeTranscriptIgnoreRanges([
				{ start: 2, end: 3 },
				{ start: 0.5, end: 1.5 },
				{ start: 1.5, end: 2.5 },
				{ start: 4, end: 4 }
			])
		).toEqual([{ start: 0.5, end: 3 }]);
		expect(subtractTranscriptIgnoreRanges([{ start: 0, end: 4 }], [{ start: 1, end: 3 }])).toEqual([
			{ start: 0, end: 1 },
			{ start: 3, end: 4 }
		]);
	});

	it('keeps repeated timeline uses of one media independent', () => {
		const firstUse = word('first-use', 1, 2);
		const repeatedUse = { ...word('repeat-use', 1, 2), sourceItemId: 'repeat' };
		transcriptIgnoreStore.ignore([firstUse]);

		expect(transcriptIgnoreStore.isIgnored(firstUse)).toBe(true);
		expect(transcriptIgnoreStore.isIgnored(repeatedUse)).toBe(false);
		expect(transcriptIgnoreStore.targets).toEqual({
			source: { mediaId: 'media', ranges: [{ start: 1, end: 2 }] }
		});
	});

	it('stages and restores words while exposing exact review totals', () => {
		const first = word('first', 1, 1.4);
		const second = word('second', 1.4, 1.8);
		transcriptIgnoreStore.ignore([first, second]);

		expect(transcriptIgnoreStore.ranges).toEqual({ media: [{ start: 1, end: 1.8 }] });
		expect(transcriptIgnoreStore.spanCount).toBe(1);
		expect(transcriptIgnoreStore.durationSeconds).toBeCloseTo(0.8);
		expect(transcriptIgnoreStore.isIgnored(first)).toBe(true);
		expect(isTranscriptWordIgnored(word('overlap', 0.8, 1.2), transcriptIgnoreStore.ranges)).toBe(
			true
		);

		transcriptIgnoreStore.restore([first]);
		expect(transcriptIgnoreStore.isIgnored(first)).toBe(false);
		expect(transcriptIgnoreStore.isIgnored(second)).toBe(true);
	});
});
