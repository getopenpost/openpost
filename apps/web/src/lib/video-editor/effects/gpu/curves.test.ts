import { describe, expect, it } from 'vitest';
import { CURVE_MAX_POINTS, curvePointInsertIndex, type CurvePoint } from './curves';

function point(x: number, y = x): CurvePoint {
	return { x, y };
}

describe('curvePointInsertIndex', () => {
	it('inserts between neighbors with room on both sides', () => {
		expect(curvePointInsertIndex([point(0), point(1)], point(0.5))).toBe(1);
	});

	it('matches FreeCut click-to-add density with a half-gap rule', () => {
		const points = [point(0), point(0.5), point(1)];
		// 0.021 clears half the 0.04 drag gap, so the click lands.
		expect(curvePointInsertIndex(points, point(0.521))).toBe(2);
		// Inside half the gap the click is rejected, like FreeCut.
		expect(curvePointInsertIndex(points, point(0.519))).toBeNull();
		// The same half-gap rule applies on the left side of a neighbor.
		expect(curvePointInsertIndex(points, point(0.479))).toBe(1);
		expect(curvePointInsertIndex(points, point(0.481))).toBeNull();
	});

	it('rejects clicks too close to the pinned endpoints', () => {
		const points = [point(0), point(1)];
		expect(curvePointInsertIndex(points, point(0.01))).toBeNull();
		expect(curvePointInsertIndex(points, point(0.99))).toBeNull();
	});

	it('refuses inserts once the lane is full', () => {
		const points = Array.from({ length: CURVE_MAX_POINTS }, (_, index) =>
			point(index / (CURVE_MAX_POINTS - 1))
		);
		expect(curvePointInsertIndex(points, point(0.5))).toBeNull();
	});
});
