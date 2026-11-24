import { describe, expect, it } from 'vitest';
import { createSegment, normalizeSegments, segmentsOutsideMarkedRanges } from './model';

const SRC_A = 'src-a';
const SRC_B = 'src-b';

describe('quick-cut model', () => {
	it('normalizes overlapping segments per source', () => {
		const segs = [
			createSegment(0, 5, { id: 'a', sourceId: SRC_A }),
			createSegment(3, 7, { id: 'b', sourceId: SRC_A }),
			createSegment(8, 10, { id: 'c', sourceId: SRC_A })
		];
		const norm = normalizeSegments(segs);
		expect(norm).toHaveLength(2);
		expect(norm[0]?.start).toBe(0);
		expect(norm[0]?.end).toBe(7);
	});

	it('never reorders an explicit A/B/A edit while normalizing', () => {
		const segments = [
			createSegment(0, 2, { id: 'a1', sourceId: SRC_A }),
			createSegment(0, 1, { id: 'b1', sourceId: SRC_B }),
			createSegment(1, 3, { id: 'a2', sourceId: SRC_A })
		];
		expect(normalizeSegments(segments).map((segment) => segment.id)).toEqual(['a1', 'b1', 'a2']);
	});

	it('exports the material outside marked removal ranges per source', () => {
		const marked = [
			createSegment(2, 4, { id: 'a-first', sourceId: SRC_A }),
			createSegment(6, 9, { id: 'a-last', sourceId: SRC_A }),
			createSegment(1, 3, { id: 'b-only', sourceId: SRC_B })
		];

		expect(
			segmentsOutsideMarkedRanges(marked, [
				{ id: SRC_A, duration: 10 },
				{ id: SRC_B, duration: 5 }
			]).map(({ sourceId, start, end }) => ({ sourceId, start, end }))
		).toEqual([
			{ sourceId: SRC_A, start: 0, end: 2 },
			{ sourceId: SRC_A, start: 4, end: 6 },
			{ sourceId: SRC_A, start: 9, end: 10 },
			{ sourceId: SRC_B, start: 0, end: 1 },
			{ sourceId: SRC_B, start: 3, end: 5 }
		]);
	});

	it('unions touching removal ranges and ignores disabled marks', () => {
		const marked = [
			createSegment(0, 2, { id: 'start', sourceId: SRC_A }),
			createSegment(1, 4, { id: 'overlap', sourceId: SRC_A }),
			createSegment(4, 6, { id: 'touching', sourceId: SRC_A }),
			{
				...createSegment(7, 9, { id: 'disabled', sourceId: SRC_A }),
				enabled: false
			}
		];

		expect(
			segmentsOutsideMarkedRanges(marked, [{ id: SRC_A, duration: 10 }]).map(({ start, end }) => ({
				start,
				end
			}))
		).toEqual([{ start: 6, end: 10 }]);
	});
});
