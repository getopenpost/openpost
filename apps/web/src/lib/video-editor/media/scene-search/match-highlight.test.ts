import { describe, expect, it } from 'vitest';
import { splitTextBySpans } from './match-highlight';

describe('splitTextBySpans', () => {
	it('returns the whole text unmarked when there are no spans', () => {
		expect(splitTextBySpans('sunset over the lake', [])).toEqual([
			{ text: 'sunset over the lake', mark: false }
		]);
	});

	it('marks each match span and keeps the surrounding text', () => {
		expect(
			splitTextBySpans('sunset over the lake', [
				[0, 6],
				[16, 20]
			])
		).toEqual([
			{ text: 'sunset', mark: true },
			{ text: ' over the ', mark: false },
			{ text: 'lake', mark: true }
		]);
	});

	it('clamps out-of-range spans instead of dropping characters', () => {
		expect(splitTextBySpans('hi', [[-4, 99]])).toEqual([{ text: 'hi', mark: true }]);
	});

	it('returns no segments for empty text', () => {
		expect(splitTextBySpans('', [[0, 2]])).toEqual([]);
	});
});
