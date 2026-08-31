import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../project/types';
import { activeWordIndexAtFrame, hasUsableKaraokeTimings, karaokeStateAtFrame } from './karaoke';

function cueWithWords(): SubtitleCue {
	return {
		id: 'c1',
		startFrame: 0,
		endFrame: 60,
		text: 'hello world again',
		words: [
			{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
			{ id: 'w2', startFrame: 10, endFrame: 20, text: 'world' },
			{ id: 'w3', startFrame: 20, endFrame: 30, text: 'again' }
		]
	};
}

describe('karaoke deterministic active-word boundaries', () => {
	it('uses inclusive start / exclusive end, advancing at the exact boundary', () => {
		const words = cueWithWords().words!;
		expect(activeWordIndexAtFrame(words, -1)).toBe(-1);
		expect(activeWordIndexAtFrame(words, 0)).toBe(0);
		expect(activeWordIndexAtFrame(words, 9)).toBe(0);
		expect(activeWordIndexAtFrame(words, 10)).toBe(1);
		expect(activeWordIndexAtFrame(words, 19)).toBe(1);
		expect(activeWordIndexAtFrame(words, 20)).toBe(2);
		expect(activeWordIndexAtFrame(words, 29)).toBe(2);
		expect(activeWordIndexAtFrame(words, 30)).toBe(-1);
		expect(activeWordIndexAtFrame(words, 60)).toBe(-1);
	});

	it('returns -1 inside gaps between word timings', () => {
		const words = [
			{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' },
			{ id: 'w2', startFrame: 12, endFrame: 20, text: 'world' }
		];
		expect(activeWordIndexAtFrame(words, 11)).toBe(-1);
		expect(activeWordIndexAtFrame(words, 12)).toBe(1);
	});
});

describe('untimed fallback', () => {
	it('falls back to normal caption when cue has no words', () => {
		const cue: SubtitleCue = { id: 'c', startFrame: 0, endFrame: 10, text: 'hello' };
		expect(hasUsableKaraokeTimings(cue, 'hello')).toBe(false);
		expect(karaokeStateAtFrame({ captionHighlightMode: 'karaoke' }, cue, 'hello', 0)).toBeNull();
	});

	it('falls back when word count does not match plain-text tokens', () => {
		const cue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 10,
			text: 'hello world',
			words: [{ id: 'w1', startFrame: 0, endFrame: 10, text: 'hello' }]
		};
		expect(hasUsableKaraokeTimings(cue, 'hello world')).toBe(false);
	});

	it('falls back when a word timing is invalid (start >= end)', () => {
		const cue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 10,
			text: 'hello world',
			words: [
				{ id: 'w1', startFrame: 5, endFrame: 5, text: 'hello' },
				{ id: 'w2', startFrame: 6, endFrame: 10, text: 'world' }
			]
		};
		expect(hasUsableKaraokeTimings(cue, 'hello world')).toBe(false);
	});

	it('falls back when token text mismatches word text (edited cue)', () => {
		const cue: SubtitleCue = {
			id: 'c',
			startFrame: 0,
			endFrame: 10,
			text: 'hello world',
			words: [
				{ id: 'w1', startFrame: 0, endFrame: 5, text: 'hello' },
				{ id: 'w2', startFrame: 5, endFrame: 10, text: 'there' }
			]
		};
		expect(hasUsableKaraokeTimings(cue, 'hello world')).toBe(false);
	});

	it('falls back when karaoke mode is not enabled', () => {
		const cue = cueWithWords();
		expect(
			karaokeStateAtFrame({ captionHighlightMode: 'normal' }, cue, 'hello world again', 5)
		).toBeNull();
		expect(karaokeStateAtFrame({}, cue, 'hello world again', 5)).toBeNull();
	});

	it('falls back when no word is active at that frame yet still renders cue', () => {
		const cue = cueWithWords();
		expect(
			karaokeStateAtFrame({ captionHighlightMode: 'karaoke' }, cue, 'hello world again', -1)
		).toBeNull();
		expect(
			karaokeStateAtFrame({ captionHighlightMode: 'karaoke' }, cue, 'hello world again', 45)
		).toBeNull();
	});
});
