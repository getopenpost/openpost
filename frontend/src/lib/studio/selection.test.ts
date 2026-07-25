import { describe, expect, it } from 'vitest';
import {
	boundsIntersect,
	colorsWithinTolerance,
	mergeSelectionIDs,
	normalizeSelectionBounds,
	pointInPolygon,
	polygonIntersectsBounds
} from './selection';

describe('Studio area selection geometry', () => {
	it('normalizes reverse marquee drags', () => {
		expect(normalizeSelectionBounds({ x: 80, y: 60 }, { x: 20, y: 10 })).toEqual({
			x: 20,
			y: 10,
			width: 60,
			height: 50
		});
	});

	it('detects intersecting bounds, including touching edges', () => {
		expect(
			boundsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 2, width: 4, height: 4 })
		).toBe(true);
		expect(
			boundsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 2, width: 4, height: 4 })
		).toBe(false);
	});

	it('finds points and layer bounds crossed by a lasso', () => {
		const polygon = [
			{ x: 0, y: 0 },
			{ x: 30, y: 0 },
			{ x: 15, y: 30 }
		];
		expect(pointInPolygon({ x: 15, y: 10 }, polygon)).toBe(true);
		expect(pointInPolygon({ x: 28, y: 28 }, polygon)).toBe(false);
		expect(polygonIntersectsBounds(polygon, { x: 13, y: 8, width: 4, height: 4 })).toBe(true);
		expect(polygonIntersectsBounds(polygon, { x: 27, y: 27, width: 2, height: 2 })).toBe(false);
	});
});

describe('Studio selection composition', () => {
	it('supports replace, add, subtract, and toggle without duplicate IDs', () => {
		expect(mergeSelectionIDs(['a'], ['b', 'b'], 'replace')).toEqual(['b']);
		expect(mergeSelectionIDs(['a'], ['a', 'b'], 'add')).toEqual(['a', 'b']);
		expect(mergeSelectionIDs(['a', 'b'], ['b'], 'subtract')).toEqual(['a']);
		expect(mergeSelectionIDs(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
	});

	it('matches flat colors using a normalized tolerance', () => {
		expect(colorsWithinTolerance('#f97316', '#f97316ff', 0)).toBe(true);
		expect(colorsWithinTolerance('#f97316', '#f47720', 4)).toBe(true);
		expect(colorsWithinTolerance('#f97316', '#0ea5e9', 4)).toBe(false);
		expect(colorsWithinTolerance('transparent', '#ffffff', 100)).toBe(false);
	});
});
