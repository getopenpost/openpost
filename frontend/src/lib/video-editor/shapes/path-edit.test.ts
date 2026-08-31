import { describe, expect, it } from 'vitest';
import type { ShapePathVertex } from '../project/types';
import {
	closestPathSegment,
	fitDrawnPath,
	insertPathVertex,
	movePathHandle,
	pathSvgData,
	pathVertexToBezier,
	pathVertexToCorner,
	removePathVertex,
	reversePathVertices,
	rotateClosedPathStart
} from './path-edit';

const line: ShapePathVertex[] = [
	{ position: [0, 0], inHandle: [0, 0], outHandle: [0.25, 0] },
	{ position: [1, 1], inHandle: [-0.25, 0], outHandle: [0, 0] }
];

describe('path editing', () => {
	it('splits a cubic without moving either half', () => {
		const result = insertPathVertex(line, 0, 0.5);
		expect(result).toHaveLength(3);
		expect(result[1]?.position).toEqual([0.5, 0.5]);
		expect(result[0]?.outHandle).toEqual([0.125, 0]);
		expect(result[2]?.inHandle).toEqual([-0.125, 0]);
	});

	it('converts vertices between corner and continuous tangents', () => {
		const curved = pathVertexToBezier(
			[
				{ position: [0, 0.5], inHandle: [0, 0], outHandle: [0, 0] },
				{ position: [0.5, 0.2], inHandle: [0, 0], outHandle: [0, 0] },
				{ position: [1, 0.5], inHandle: [0, 0], outHandle: [0, 0] }
			],
			1,
			false
		);
		expect(curved[1]?.tangentMode).toBe('continuous');
		expect(curved[1]?.inHandle).not.toEqual([0, 0]);
		expect(pathVertexToCorner(curved, 1)[1]).toMatchObject({
			inHandle: [0, 0],
			outHandle: [0, 0],
			tangentMode: 'corner'
		});
	});

	it('keeps opposite handle length while a continuous tangent moves', () => {
		const moved = movePathHandle(line, 0, 'out', [0, 0.5], false);
		expect(moved[0]?.outHandle).toEqual([0, 0.5]);
		expect(moved[0]?.inHandle[0]).toBeCloseTo(0);
		expect(moved[0]?.tangentMode).toBe('continuous');
	});

	it('reverses traversal and rotates a closed start without moving the path', () => {
		const vertices: ShapePathVertex[] = [
			{ position: [0, 0], inHandle: [-0.1, 0], outHandle: [0.2, 0.3] },
			{ position: [1, 0], inHandle: [-0.3, -0.2], outHandle: [0.1, 0] },
			{ position: [1, 1], inHandle: [0, -0.2], outHandle: [0, 0.1] }
		];
		const reversed = reversePathVertices(vertices);
		expect(reversed.map((vertex) => vertex.position)).toEqual([
			[1, 1],
			[1, 0],
			[0, 0]
		]);
		expect(reversed[1]?.inHandle).toEqual([0.1, 0]);
		expect(reversed[2]?.outHandle).toEqual([-0.1, 0]);
		expect(rotateClosedPathStart(vertices, 2).map((vertex) => vertex.position)).toEqual([
			[1, 1],
			[0, 0],
			[1, 0]
		]);
	});

	it('finds a segment, removes valid vertices, and writes SVG data', () => {
		expect(closestPathSegment(line, [0.5, 0.5], false)?.afterIndex).toBe(0);
		expect(removePathVertex([...line, line[0]!], 1, 2)).toHaveLength(2);
		expect(removePathVertex(line, 0, 2)).toBeNull();
		expect(pathSvgData(line, 100, 50, false)).toContain('C 25 0 75 50 100 50');
	});

	it('fits full-canvas drawing coordinates without moving the path', () => {
		const fitted = fitDrawnPath(
			[
				{ position: [0.25, 0.25], inHandle: [0, 0], outHandle: [0, 0] },
				{ position: [0.75, 0.75], inHandle: [0, 0], outHandle: [0, 0] }
			],
			{ width: 200, height: 100 },
			200,
			100,
			0
		);
		expect(fitted.transform).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
		expect(fitted.vertices.map((vertex) => vertex.position)).toEqual([
			[0, 0],
			[1, 1]
		]);
	});
});
