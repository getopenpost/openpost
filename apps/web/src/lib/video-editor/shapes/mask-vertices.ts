/**
 * Mask-vertex bezier conversion with direction preservation.
 *
 * Ported from FreeCut (MIT) `convertVertexToBezier` in
 * `features/preview/utils/mask-path-utils.ts`. The shared
 * `pathVertexToBezier` in `./path-edit` rebuilds handles from the smooth
 * bisector; this variant preserves already-authored handle lengths and
 * directions instead, so converting a hand-tuned knot to "smooth" does not
 * visibly move the curve. Vertex positions and handles stay normalized to
 * the owning item bounds.
 */

import type { ShapePathVertex } from '../project/types';

const DEFAULT_HANDLE_SCALE = 0.25;

function cloneVertex(vertex: ShapePathVertex): ShapePathVertex {
	return {
		...vertex,
		position: [...vertex.position],
		inHandle: [...vertex.inHandle],
		outHandle: [...vertex.outHandle]
	};
}

function vectorLength(vector: readonly [number, number]): number {
	return Math.hypot(vector[0], vector[1]);
}

function normalizeVector(vector: readonly [number, number]): [number, number] {
	const magnitude = vectorLength(vector);
	if (magnitude <= Number.EPSILON) return [0, 0];
	return [vector[0] / magnitude, vector[1] / magnitude];
}

function smoothTangentDirection(
	previous: readonly [number, number],
	current: readonly [number, number],
	next: readonly [number, number]
): [number, number] {
	const incoming = normalizeVector([current[0] - previous[0], current[1] - previous[1]]);
	const outgoing = normalizeVector([next[0] - current[0], next[1] - current[1]]);
	const combined = normalizeVector([incoming[0] + outgoing[0], incoming[1] + outgoing[1]]);
	if (combined[0] !== 0 || combined[1] !== 0) return combined;
	if (outgoing[0] !== 0 || outgoing[1] !== 0) return outgoing;
	return incoming;
}

function toCorner(vertices: ShapePathVertex[], index: number): ShapePathVertex[] {
	const result = vertices.map(cloneVertex);
	result[index] = {
		...result[index]!,
		inHandle: [0, 0],
		outHandle: [0, 0],
		tangentMode: 'corner'
	};
	return result;
}

/**
 * Convert a vertex to a smooth bezier knot while keeping authored handle
 * geometry: existing handle lengths are preserved, and the tangent direction
 * prefers the combined existing direction, then the outgoing, incoming, and
 * finally the smooth bisector. Degenerate knots fall back to a corner.
 */
export function maskVertexToBezier(
	vertices: ShapePathVertex[],
	index: number,
	closed = true
): ShapePathVertex[] {
	const source = vertices[index];
	if (!source || vertices.length < 2) return vertices;

	const result = vertices.map(cloneVertex);
	const vertex = result[index]!;
	const previous =
		!closed && index === 0 ? vertex : result[(index - 1 + result.length) % result.length]!;
	const next =
		!closed && index === result.length - 1 ? vertex : result[(index + 1) % result.length]!;

	const existingInLength = vectorLength(vertex.inHandle);
	const existingOutLength = vectorLength(vertex.outHandle);
	const previousDistance = Math.hypot(
		vertex.position[0] - previous.position[0],
		vertex.position[1] - previous.position[1]
	);
	const nextDistance = Math.hypot(
		next.position[0] - vertex.position[0],
		next.position[1] - vertex.position[1]
	);
	const inLength = existingInLength || previousDistance * DEFAULT_HANDLE_SCALE;
	const outLength = existingOutLength || nextDistance * DEFAULT_HANDLE_SCALE;

	const existingInDirection =
		existingInLength > 0 ? normalizeVector([-vertex.inHandle[0], -vertex.inHandle[1]]) : null;
	const existingOutDirection = existingOutLength > 0 ? normalizeVector(vertex.outHandle) : null;
	const combinedExistingDirection =
		existingInDirection && existingOutDirection
			? normalizeVector([
					existingInDirection[0] + existingOutDirection[0],
					existingInDirection[1] + existingOutDirection[1]
				])
			: null;

	const direction =
		combinedExistingDirection &&
		(combinedExistingDirection[0] !== 0 || combinedExistingDirection[1] !== 0)
			? combinedExistingDirection
			: (existingOutDirection ??
				existingInDirection ??
				smoothTangentDirection(previous.position, vertex.position, next.position));

	if (direction[0] === 0 && direction[1] === 0) return toCorner(result, index);

	vertex.inHandle = [-direction[0] * inLength, -direction[1] * inLength];
	vertex.outHandle = [direction[0] * outLength, direction[1] * outLength];
	vertex.tangentMode = 'continuous';
	return result;
}
