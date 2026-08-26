import { describe, expect, it } from 'vitest';
import {
	createSegment,
	validateSegments,
	normalizeSegments,
	reorderSegment,
	findNearestKeyframe,
	findSnapKeyframe,
	formatTimecode,
	parseTimecode,
	hasOverlap
} from './model';

const SRC_A = 'src-a';
const SRC_B = 'src-b';

describe('quick-cut model', () => {
	it('detects overlap per source and validates segments', () => {
		const a = createSegment(0, 5, { id: 'a', sourceId: SRC_A });
		const b = createSegment(4, 8, { id: 'b', sourceId: SRC_A });
		expect(hasOverlap([a, b])).toBe(true);
		const errors = validateSegments(
			[a, b],
			10,
			new Map([
				[SRC_A, 10],
				[SRC_B, 10]
			])
		);
		expect(errors.some((e) => e.kind === 'overlap')).toBe(true);
		const c = createSegment(0, 5, { id: 'c', sourceId: SRC_B });
		expect(hasOverlap([a, c])).toBe(false);
	});

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

	it('keeps disabled segments out of overlap checks', () => {
		const first = createSegment(0, 5, { id: 'first', sourceId: SRC_A });
		const disabled = {
			...createSegment(2, 4, { id: 'disabled', sourceId: SRC_A }),
			enabled: false
		};
		expect(hasOverlap([first, disabled])).toBe(false);
		expect(validateSegments([first, disabled], 10, new Map([[SRC_A, 10]]))).toEqual([]);
	});

	it('rejects a non-empty source ID that is not in the project', () => {
		const missing = createSegment(0, 1, { id: 'missing', sourceId: 'removed-source' });
		const errors = validateSegments([missing], 10, new Map([[SRC_A, 10]]));
		expect(errors).toContainEqual(
			expect.objectContaining({ segmentId: 'missing', kind: 'missing_source' })
		);
	});

	it('reorders segments preserving explicit order', () => {
		const segs = [
			createSegment(0, 1, { id: 'a', sourceId: SRC_A }),
			createSegment(2, 3, { id: 'b', sourceId: SRC_A }),
			createSegment(4, 5, { id: 'c', sourceId: SRC_A })
		];
		const moved = reorderSegment(segs, 0, 2);
		expect(moved.map((s) => s.id)).toEqual(['b', 'c', 'a']);
	});

	it('finds nearest and snap keyframe', () => {
		const kfs = [0, 2.0, 4.0, 6.0];
		expect(findNearestKeyframe(2.04, kfs, 0.06).aligned).toBe(true);
		expect(findSnapKeyframe(2.1, kfs).direction).toBe('before');
		expect(findSnapKeyframe(3.9, kfs).direction).toBe('after');
	});

	it('formats and parses timecodes', () => {
		expect(formatTimecode(65.5)).toBe('01:05.50');
		expect(parseTimecode('01:05.50')).toBeCloseTo(65.5);
		expect(parseTimecode('90')).toBe(90);
	});

	it('rejects invalid ranges beyond duration per source', () => {
		const seg = createSegment(9, 11, { id: 'x', sourceId: SRC_A });
		const errs = validateSegments([seg], 10, new Map([[SRC_A, 10]]));
		expect(errs.some((e) => e.kind === 'end_beyond_duration')).toBe(true);
	});
});
