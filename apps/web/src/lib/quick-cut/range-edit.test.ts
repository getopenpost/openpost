import { describe, expect, it } from 'vitest';
import { removeSourceRanges } from './range-edit';
import type { QuickCutSegment } from './types';

const segment = (id: string, sourceId: string, start: number, end: number): QuickCutSegment => ({
	id,
	sourceId,
	start,
	end
});
describe('Quick Cut source edits', () => {
	it('removes words from kept material without restoring prior cuts or changing other sources', () => {
		const cuts = [segment('a', 'one', 0, 3), segment('b', 'one', 5, 10), segment('c', 'two', 1, 4)];
		const result = removeSourceRanges(cuts, 'one', [
			{ start: 2, end: 6 },
			{ start: 8, end: 9 }
		]);
		expect(result.map(({ sourceId, start, end }) => ({ sourceId, start, end }))).toEqual([
			{ sourceId: 'one', start: 0, end: 2 },
			{ sourceId: 'one', start: 6, end: 8 },
			{ sourceId: 'one', start: 9, end: 10 },
			{ sourceId: 'two', start: 1, end: 4 }
		]);
		expect(result[3]).toBe(cuts[2]);
		expect(result.slice(0, 3).every((cut) => cut.cutMode === 'exact')).toBe(true);
		expect(cuts[0]?.end).toBe(3);
	});
	it('allows removal of all material and ignores invalid ranges', () => {
		const cuts = [segment('a', 'one', 0, 2)];
		expect(removeSourceRanges(cuts, 'one', [{ start: 0, end: 2 }])).toEqual([]);
		expect(
			removeSourceRanges(cuts, 'one', [
				{ start: NaN, end: 2 },
				{ start: 2, end: 1 }
			])
		).toEqual(cuts);
	});
});
