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

	it('finds a segment, removes valid vertices, and writes SVG data', () => {
		expect(closestPathSegment(line, [0.5, 0.5], false)?.afterIndex).toBe(0);
		expect(removePathVertex([...line, line[0]!], 1, 2)).toHaveLength(2);
		expect(removePathVertex(line, 0, 2)).toBeNull();
		expect(pathSvgData(line, 100, 50, false)).toContain('C 25 0 75 50 100 50');
	});
});
