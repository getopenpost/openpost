import { describe, expect, it } from 'vitest';
import type { ShapePathVertex } from '../project/types';
import { maskVertexToBezier } from './mask-vertices';

function vertex(overrides: Partial<ShapePathVertex> = {}): ShapePathVertex {
	return {
		position: [0.5, 0.5],
		inHandle: [0, 0],
		outHandle: [0, 0],
		...overrides
	};
}

describe('maskVertexToBezier', () => {
	it('synthesizes smooth handles for a corner knot on a straight run', () => {
		const vertices = [vertex({ position: [0.2, 0.5] }), vertex(), vertex({ position: [0.8, 0.5] })];
		const next = maskVertexToBezier(vertices, 1);
		expect(next[1]!.tangentMode).toBe('continuous');
		expect(next[1]!.outHandle[0]).toBeGreaterThan(0);
		expect(next[1]!.inHandle[0]).toBeLessThan(0);
		expect(next[1]!.outHandle[1]).toBeCloseTo(0, 10);
		// Source array is untouched.
		expect(vertices[1]!.tangentMode).toBeUndefined();
	});

	it('preserves existing handle lengths and the authored direction', () => {
		const vertices = [
			vertex({ position: [0.2, 0.5] }),
			vertex({ position: [0.5, 0.5], inHandle: [-0.1, 0], outHandle: [0.2, 0] }),
			vertex({ position: [0.8, 0.5] })
		];
		const next = maskVertexToBezier(vertices, 1);
		expect(next[1]!.tangentMode).toBe('continuous');
		expect(Math.hypot(...next[1]!.inHandle)).toBeCloseTo(0.1, 10);
		expect(Math.hypot(...next[1]!.outHandle)).toBeCloseTo(0.2, 10);
		expect(next[1]!.outHandle[0]).toBeGreaterThan(0);
		expect(next[1]!.inHandle[0]).toBeLessThan(0);
	});

	it('falls back to a corner for a fully degenerate knot', () => {
		const vertices = [vertex(), vertex(), vertex()];
		const next = maskVertexToBezier(vertices, 1);
		expect(next[1]!.tangentMode).toBe('corner');
		expect(next[1]!.inHandle).toEqual([0, 0]);
		expect(next[1]!.outHandle).toEqual([0, 0]);
	});

	it('returns the input for missing vertices or single-point paths', () => {
		const single = [vertex()];
		expect(maskVertexToBezier(single, 0)).toBe(single);
		const pair = [vertex(), vertex()];
		expect(maskVertexToBezier(pair, 7)).toBe(pair);
	});
});
