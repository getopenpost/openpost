import { describe, expect, it } from 'vitest';
import {
	boundsIntersect,
	combinePixelMasks,
	colorsWithinTolerance,
	ellipsePixelMask,
	magicPixelMask,
	mergeSelectionIDs,
	normalizeSelectionBounds,
	pixelMaskBounds,
	pixelMaskContainsPoint,
	pixelSpansToMask,
	pixelMaskToSpans,
	pointInPolygon,
	polygonIntersectsBounds,
	rectanglePixelMask,
	strokePixelMask,
	smoothSelectionPoints,
	subtractPixelMasks,
	translatePixelMask,
	transformPixelMask,
	pixelMaskTransformAround
} from './selection';

describe('OpenPost Image Editor area selection geometry', () => {
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

describe('OpenPost Image Editor selection composition', () => {
	it('supports replace, add, subtract, intersect, and toggle without duplicate IDs', () => {
		expect(mergeSelectionIDs(['a'], ['b', 'b'], 'replace')).toEqual(['b']);
		expect(mergeSelectionIDs(['a'], ['a', 'b'], 'add')).toEqual(['a', 'b']);
		expect(mergeSelectionIDs(['a', 'b'], ['b'], 'subtract')).toEqual(['a']);
		expect(mergeSelectionIDs(['a', 'b'], ['b', 'c'], 'intersect')).toEqual(['b']);
		expect(mergeSelectionIDs(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
	});

	it('creates and composes real pixel masks for rectangle and ellipse selections', () => {
		const rectangle = rectanglePixelMask(8, 8, { x: 1, y: 1, width: 5, height: 4 });
		const ellipse = ellipsePixelMask(8, 8, { x: 2, y: 2, width: 4, height: 4 });
		const subtracted = combinePixelMasks(rectangle, ellipse, 'subtract');
		const intersected = combinePixelMasks(rectangle, ellipse, 'intersect');

		expect(rectangle.reduce((total, value) => total + value, 0)).toBe(20);
		expect(ellipse.reduce((total, value) => total + value, 0)).toBeGreaterThan(8);
		expect(subtracted.reduce((total, value) => total + value, 0)).toBeLessThan(20);
		expect(intersected.reduce((total, value) => total + value, 0)).toBeGreaterThan(0);
		expect(intersected.reduce((total, value) => total + value, 0)).toBeLessThan(
			ellipse.reduce((total, value) => total + value, 0)
		);
		expect(pixelMaskBounds(ellipse, 8, 8)).toEqual({ x: 2, y: 2, width: 4, height: 4 });
	});

	it('flood-selects contiguous pixels using 0-255 tolerance', () => {
		const pixels = new Uint8ClampedArray([
			10, 10, 10, 255, 12, 12, 12, 255, 220, 220, 220, 255, 10, 10, 10, 255, 200, 200, 200, 255, 10,
			10, 10, 255
		]);
		const contiguous = magicPixelMask(
			{ width: 3, height: 2, data: pixels },
			{ x: 0, y: 0 },
			4,
			true
		);
		const global = magicPixelMask({ width: 3, height: 2, data: pixels }, { x: 0, y: 0 }, 4, false);

		expect([...contiguous]).toEqual([1, 1, 0, 1, 0, 0]);
		expect([...global]).toEqual([1, 1, 0, 1, 0, 1]);
	});

	it('rasterizes hard pencil strokes into compact scanline spans', () => {
		const mask = strokePixelMask(
			12,
			8,
			[
				{ x: 2, y: 4 },
				{ x: 9, y: 4 }
			],
			3
		);
		const spans = pixelMaskToSpans(mask, 12, 8);

		expect(spans.length).toBeGreaterThan(0);
		expect(spans.some((span) => span.width >= 7)).toBe(true);
	});

	it('uses pen pressure to vary the pencil footprint', () => {
		const light = strokePixelMask(40, 40, [{ x: 20, y: 20, pressure: 0.15 }], 20);
		const heavy = strokePixelMask(40, 40, [{ x: 20, y: 20, pressure: 1 }], 20);

		expect(light.reduce((total, value) => total + value, 0)).toBeLessThan(
			heavy.reduce((total, value) => total + value, 0)
		);
	});

	it('smooths intermediate samples while preserving stroke endpoints', () => {
		const points = [
			{ x: 0, y: 0, pressure: 0.5 },
			{ x: 10, y: 20, pressure: 0.75 },
			{ x: 20, y: 0, pressure: 1 }
		];
		const smoothed = smoothSelectionPoints(points, 0.5);

		expect(smoothed[0]).toEqual(points[0]);
		expect(smoothed[1].y).toBe(10);
		expect(smoothed[2]).toEqual(points[2]);
	});

	it('adds deterministic edge texture to rough pencil strokes', () => {
		const smooth = strokePixelMask(
			32,
			20,
			[
				{ x: 4, y: 10 },
				{ x: 28, y: 10 }
			],
			9
		);
		const rough = strokePixelMask(
			32,
			20,
			[
				{ x: 4, y: 10 },
				{ x: 28, y: 10 }
			],
			9,
			1
		);

		expect(rough.reduce((total, value) => total + value, 0)).toBeLessThan(
			smooth.reduce((total, value) => total + value, 0)
		);
		expect(rough).toEqual(
			strokePixelMask(
				32,
				20,
				[
					{ x: 4, y: 10 },
					{ x: 28, y: 10 }
				],
				9,
				1
			)
		);
	});

	it('moves a pixel selection without leaving a stale copy', () => {
		const original = rectanglePixelMask(8, 6, { x: 1, y: 1, width: 3, height: 2 });
		const moved = translatePixelMask(original, 8, 6, 2, 1);

		expect(pixelMaskContainsPoint(moved, 8, 6, { x: 3, y: 2 })).toBe(true);
		expect(pixelMaskContainsPoint(moved, 8, 6, { x: 1, y: 1 })).toBe(false);
		expect(moved.reduce((total, value) => total + value, 0)).toBe(6);
	});

	it('resizes and rotates masks around an explicit transform origin', () => {
		const original = rectanglePixelMask(20, 20, { x: 4, y: 4, width: 4, height: 2 });
		const resized = transformPixelMask(
			original,
			20,
			20,
			pixelMaskTransformAround({ x: 4, y: 4 }, 2, 2)
		);
		expect(pixelMaskBounds(resized, 20, 20)).toEqual({ x: 4, y: 4, width: 8, height: 4 });

		const rotated = transformPixelMask(
			original,
			20,
			20,
			pixelMaskTransformAround({ x: 6, y: 5 }, 1, 1, 90)
		);
		expect(pixelMaskBounds(rotated, 20, 20)).toEqual({ x: 5, y: 3, width: 2, height: 4 });
	});

	it('subtracts an erase mask from compact paint spans', () => {
		const paint = pixelSpansToMask([{ x: 0, y: 1, width: 6 }], 6, 3);
		const erase = rectanglePixelMask(6, 3, { x: 2, y: 0, width: 2, height: 3 });
		const result = subtractPixelMasks(paint, erase);

		expect(pixelMaskToSpans(result, 6, 3)).toEqual([
			{ x: 0, y: 1, width: 2 },
			{ x: 4, y: 1, width: 2 }
		]);
	});

	it('matches flat colors using a normalized tolerance', () => {
		expect(colorsWithinTolerance('#f97316', '#f97316ff', 0)).toBe(true);
		expect(colorsWithinTolerance('#f97316', '#f47720', 4)).toBe(true);
		expect(colorsWithinTolerance('#f97316', '#0ea5e9', 4)).toBe(false);
		expect(colorsWithinTolerance('transparent', '#ffffff', 100)).toBe(false);
	});
});
