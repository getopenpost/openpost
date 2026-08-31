import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../project/types';
import {
	correctedCueTiming,
	correctedCueTimingPatch,
	correctedCueWords,
	correctedSubtitleWord
} from './caption-correction';

const cue: SubtitleCue = {
	id: 'cue',
	startFrame: 10,
	endFrame: 50,
	text: 'One two',
	words: [
		{ id: 'one', startFrame: 10, endFrame: 25, text: 'One' },
		{ id: 'two', startFrame: 30, endFrame: 50, text: 'two' }
	]
};

describe('caption correction', () => {
	it('rejects non-finite cue input and keeps intervals non-empty', () => {
		expect(correctedCueTiming(cue, Number.NaN, Number.NaN)).toEqual({
			startFrame: 10,
			endFrame: 50
		});
		expect(correctedCueTiming(cue, 60, 40)).toEqual({ startFrame: 60, endFrame: 61 });
	});

	it('retimes words into corrected cue bounds without changing their identity', () => {
		expect(correctedCueTimingPatch(cue, 20, 40)).toEqual({
			startFrame: 20,
			endFrame: 40,
			words: [
				{ id: 'one', startFrame: 20, endFrame: 28, text: 'One' },
				{ id: 'two', startFrame: 30, endFrame: 40, text: 'two' }
			]
		});
	});

	it('updates word copy and timing while deriving the full cue bounds', () => {
		expect(
			correctedSubtitleWord(cue, 'one', { text: 'First', startFrame: 4, endFrame: 20 })
		).toEqual({
			words: [
				{ id: 'one', startFrame: 4, endFrame: 20, text: 'First' },
				{ id: 'two', startFrame: 30, endFrame: 50, text: 'two' }
			],
			startFrame: 4,
			endFrame: 50
		});
	});

	it('keeps word identity and timing when corrected copy has the same word count', () => {
		expect(correctedCueWords(cue, 'First second')).toEqual([
			{ id: 'one', startFrame: 10, endFrame: 25, text: 'First' },
			{ id: 'two', startFrame: 30, endFrame: 50, text: 'second' }
		]);
	});

	it('reflows changed word counts across the existing timed span', () => {
		const corrected = correctedCueWords(cue, 'One small correction');

		expect(corrected?.map((word) => word.text)).toEqual(['One', 'small', 'correction']);
		expect(corrected?.map((word) => [word.startFrame, word.endFrame])).toEqual([
			[10, 23],
			[23, 37],
			[37, 50]
		]);
		expect(corrected?.[0]?.id).toBe('one');
		expect(new Set(corrected?.map((word) => word.id)).size).toBe(3);
		expect(correctedCueWords(cue, '   ')).toBeUndefined();
	});

	it('does not persist NaN, inverted intervals, missing words, or no-op edits', () => {
		expect(correctedSubtitleWord(cue, 'one', { startFrame: Number.NaN })).toBeNull();
		expect(correctedSubtitleWord(cue, 'missing', { text: 'Nope' })).toBeNull();
		expect(correctedSubtitleWord(cue, 'one', { startFrame: 40, endFrame: 20 })).toMatchObject({
			words: [
				{ id: 'one', startFrame: 40, endFrame: 41 },
				{ id: 'two', startFrame: 30, endFrame: 50 }
			],
			startFrame: 30,
			endFrame: 50
		});
	});
});
