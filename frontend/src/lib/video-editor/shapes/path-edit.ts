/**
 * Bezier path editing primitives shared by the pen and mask editors.
 * Vertex positions and handles stay normalized to the owning item bounds.
 */

import type { ItemTransform, ShapePathVertex } from '../project/types';

const DEFAULT_HANDLE_SCALE = 0.25;

function cloneVertex(vertex: ShapePathVertex): ShapePathVertex {
	return {
		...vertex,
		position: [...vertex.position],
		inHandle: [...vertex.inHandle],
		outHandle: [...vertex.outHandle]
	};
}

/** Reverse path traversal while leaving every cubic segment in place. */
export function reversePathVertices(vertices: ShapePathVertex[]): ShapePathVertex[] {
	return vertices.toReversed().map((vertex) => ({
		...cloneVertex(vertex),
		inHandle: [...vertex.outHandle],
		outHandle: [...vertex.inHandle]
	}));
}

/** Choose a new first point for a closed path without changing its geometry. */
export function rotateClosedPathStart(
	vertices: ShapePathVertex[],
	firstIndex: number
): ShapePathVertex[] {
	if (vertices.length === 0) return [];
	const normalizedIndex = ((firstIndex % vertices.length) + vertices.length) % vertices.length;
	return [...vertices.slice(normalizedIndex), ...vertices.slice(0, normalizedIndex)].map(
		cloneVertex
	);
}

function length(vector: readonly [number, number]): number {
	return Math.hypot(vector[0], vector[1]);
}

function normalized(vector: readonly [number, number]): [number, number] {
	const magnitude = length(vector);
	return magnitude <= Number.EPSILON ? [0, 0] : [vector[0] / magnitude, vector[1] / magnitude];
}

function smoothDirection(
	previous: readonly [number, number],
	current: readonly [number, number],
	next: readonly [number, number]
): [number, number] {
	const incoming = normalized([current[0] - previous[0], current[1] - previous[1]]);
	const outgoing = normalized([next[0] - current[0], next[1] - current[1]]);
	const combined = normalized([incoming[0] + outgoing[0], incoming[1] + outgoing[1]]);
	if (combined[0] !== 0 || combined[1] !== 0) return combined;
	if (outgoing[0] !== 0 || outgoing[1] !== 0) return outgoing;
	return incoming;
}

function lerp(
	left: readonly [number, number],
	right: readonly [number, number],
	t: number
): [number, number] {
	return [left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t];
}

/** Split one cubic segment with de Casteljau so the visible curve does not move. */
export function insertPathVertex(
	vertices: ShapePathVertex[],
	afterIndex: number,
	t = 0.5
): ShapePathVertex[] {
	const current = vertices[afterIndex];
	const next = vertices[(afterIndex + 1) % vertices.length];
	if (!current || !next) return vertices;
	const ratio = Math.min(1, Math.max(0, t));
	const p0 = current.position;
	const p1: [number, number] = [
		current.position[0] + current.outHandle[0],
		current.position[1] + current.outHandle[1]
	];
	const p2: [number, number] = [
		next.position[0] + next.inHandle[0],
		next.position[1] + next.inHandle[1]
	];
	const p3 = next.position;
	const q0 = lerp(p0, p1, ratio);
	const q1 = lerp(p1, p2, ratio);
	const q2 = lerp(p2, p3, ratio);
	const r0 = lerp(q0, q1, ratio);
	const r1 = lerp(q1, q2, ratio);
	const point = lerp(r0, r1, ratio);
	const curved =
		current.outHandle[0] !== 0 ||
		current.outHandle[1] !== 0 ||
		next.inHandle[0] !== 0 ||
		next.inHandle[1] !== 0;
	const inserted: ShapePathVertex = {
		position: point,
		inHandle: curved ? [r0[0] - point[0], r0[1] - point[1]] : [0, 0],
		outHandle: curved ? [r1[0] - point[0], r1[1] - point[1]] : [0, 0],
		tangentMode: curved ? 'continuous' : 'corner'
	};
	const result = vertices.map(cloneVertex);
	result[afterIndex]!.outHandle = curved ? [q0[0] - p0[0], q0[1] - p0[1]] : [0, 0];
	const nextIndex = (afterIndex + 1) % vertices.length;
	result[nextIndex]!.inHandle = curved ? [q2[0] - p3[0], q2[1] - p3[1]] : [0, 0];
	result.splice(afterIndex + 1, 0, inserted);
	return result;
}

export function pathVertexToCorner(vertices: ShapePathVertex[], index: number): ShapePathVertex[] {
	if (!vertices[index]) return vertices;
	const result = vertices.map(cloneVertex);
	result[index] = {
		...result[index]!,
		inHandle: [0, 0],
		outHandle: [0, 0],
		tangentMode: 'corner'
	};
	return result;
}

export function pathVertexToBezier(
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
	const incomingLength = length(vertex.inHandle);
	const outgoingLength = length(vertex.outHandle);
	const previousDistance = Math.hypot(
		vertex.position[0] - previous.position[0],
		vertex.position[1] - previous.position[1]
	);
	const nextDistance = Math.hypot(
		next.position[0] - vertex.position[0],
		next.position[1] - vertex.position[1]
	);
	const incoming = incomingLength || previousDistance * DEFAULT_HANDLE_SCALE;
	const outgoing = outgoingLength || nextDistance * DEFAULT_HANDLE_SCALE;
	const direction = smoothDirection(previous.position, vertex.position, next.position);
	if (direction[0] === 0 && direction[1] === 0) return pathVertexToCorner(result, index);
	vertex.inHandle = [-direction[0] * incoming, -direction[1] * incoming];
	vertex.outHandle = [direction[0] * outgoing, direction[1] * outgoing];
	vertex.tangentMode = 'continuous';
	return result;
}

export function removePathVertex(
	vertices: ShapePathVertex[],
	index: number,
	minimumVertices: number
): ShapePathVertex[] | null {
	if (!vertices[index] || vertices.length <= minimumVertices) return null;
	return vertices.filter((_, candidate) => candidate !== index).map(cloneVertex);
}

export function movePathVertex(
	vertices: ShapePathVertex[],
	index: number,
	position: [number, number]
): ShapePathVertex[] {
	if (!vertices[index]) return vertices;
	const result = vertices.map(cloneVertex);
	result[index]!.position = position;
	return result;
}

export function movePathHandle(
	vertices: ShapePathVertex[],
	index: number,
	handle: 'in' | 'out',
	value: [number, number],
	breakTangents: boolean
): ShapePathVertex[] {
	if (!vertices[index]) return vertices;
	const result = vertices.map(cloneVertex);
	const vertex = result[index]!;
	const opposite = handle === 'in' ? 'outHandle' : 'inHandle';
	const property = handle === 'in' ? 'inHandle' : 'outHandle';
	vertex[property] = value;
	if (breakTangents) {
		vertex.tangentMode = 'broken';
		return result;
	}
	const oppositeLength = length(vertex[opposite]);
	const direction = normalized([-value[0], -value[1]]);
	vertex[opposite] = [direction[0] * oppositeLength, direction[1] * oppositeLength];
	vertex.tangentMode = 'continuous';
	return result;
}

export function pathSvgData(
	vertices: ShapePathVertex[],
	width: number,
	height: number,
	closed: boolean
): string {
	const first = vertices[0];
	if (!first) return '';
	const commands = [`M ${first.position[0] * width} ${first.position[1] * height}`];
	for (let index = 1; index < vertices.length; index++) {
		const previous = vertices[index - 1]!;
		const current = vertices[index]!;
		commands.push(
			`C ${(previous.position[0] + previous.outHandle[0]) * width} ${(previous.position[1] + previous.outHandle[1]) * height} ${(current.position[0] + current.inHandle[0]) * width} ${(current.position[1] + current.inHandle[1]) * height} ${current.position[0] * width} ${current.position[1] * height}`
		);
	}
	if (closed && vertices.length > 1) {
		const last = vertices.at(-1)!;
		commands.push(
			`C ${(last.position[0] + last.outHandle[0]) * width} ${(last.position[1] + last.outHandle[1]) * height} ${(first.position[0] + first.inHandle[0]) * width} ${(first.position[1] + first.inHandle[1]) * height} ${first.position[0] * width} ${first.position[1] * height} Z`
		);
	}
	return commands.join(' ');
}

function cubicPoint(left: ShapePathVertex, right: ShapePathVertex, t: number): [number, number] {
	const p0 = left.position;
	const p1: [number, number] = [p0[0] + left.outHandle[0], p0[1] + left.outHandle[1]];
	const p3 = right.position;
	const p2: [number, number] = [p3[0] + right.inHandle[0], p3[1] + right.inHandle[1]];
	const inverse = 1 - t;
	return [
		inverse ** 3 * p0[0] +
			3 * inverse ** 2 * t * p1[0] +
			3 * inverse * t ** 2 * p2[0] +
			t ** 3 * p3[0],
		inverse ** 3 * p0[1] +
			3 * inverse ** 2 * t * p1[1] +
			3 * inverse * t ** 2 * p2[1] +
			t ** 3 * p3[1]
	];
}

/** Find the closest sampled cubic segment for double-click insertion. */
export function closestPathSegment(
	vertices: ShapePathVertex[],
	position: [number, number],
	closed: boolean
): { afterIndex: number; t: number } | null {
	const segmentCount = closed ? vertices.length : vertices.length - 1;
	if (segmentCount < 1) return null;
	let closest: { afterIndex: number; t: number; distance: number } | null = null;
	for (let index = 0; index < segmentCount; index++) {
		const left = vertices[index]!;
		const right = vertices[(index + 1) % vertices.length]!;
		for (let sample = 1; sample < 40; sample++) {
			const t = sample / 40;
			const point = cubicPoint(left, right, t);
			const distance = Math.hypot(point[0] - position[0], point[1] - position[1]);
			if (!closest || distance < closest.distance) closest = { afterIndex: index, t, distance };
		}
	}
	return closest ? { afterIndex: closest.afterIndex, t: closest.t } : null;
}

export interface FittedPath {
	vertices: ShapePathVertex[];
	transform: ItemTransform;
}

/** Fit a newly drawn full-canvas path to its own bounds without moving the curve. */
export function fitDrawnPath(
	vertices: ShapePathVertex[],
	transform: ItemTransform,
	canvasWidth: number,
	canvasHeight: number,
	padding: number
): FittedPath {
	const width = Math.max(1, transform.width ?? canvasWidth);
	const height = Math.max(1, transform.height ?? canvasHeight);
	const points = vertices.flatMap<[number, number]>((vertex) => {
		const incoming: [number, number] = [
			vertex.position[0] + vertex.inHandle[0],
			vertex.position[1] + vertex.inHandle[1]
		];
		const outgoing: [number, number] = [
			vertex.position[0] + vertex.outHandle[0],
			vertex.position[1] + vertex.outHandle[1]
		];
		return [vertex.position, incoming, outgoing];
	});
	if (points.length === 0) return { vertices, transform };
	const minX = Math.max(0, Math.min(...points.map((point) => point[0] * width)) - padding);
	const maxX = Math.min(width, Math.max(...points.map((point) => point[0] * width)) + padding);
	const minY = Math.max(0, Math.min(...points.map((point) => point[1] * height)) - padding);
	const maxY = Math.min(height, Math.max(...points.map((point) => point[1] * height)) + padding);
	const fittedWidth = Math.max(1, maxX - minX);
	const fittedHeight = Math.max(1, maxY - minY);
	const oldCenterX = canvasWidth / 2 + (transform.x ?? 0);
	const oldCenterY = canvasHeight / 2 + (transform.y ?? 0);
	const oldLeft = oldCenterX - (transform.anchorX ?? width / 2);
	const oldTop = oldCenterY - (transform.anchorY ?? height / 2);
	const centerX = oldLeft + (minX + maxX) / 2;
	const centerY = oldTop + (minY + maxY) / 2;
	return {
		vertices: vertices.map((vertex) => ({
			...vertex,
			position: [
				(vertex.position[0] * width - minX) / fittedWidth,
				(vertex.position[1] * height - minY) / fittedHeight
			],
			inHandle: [
				(vertex.inHandle[0] * width) / fittedWidth,
				(vertex.inHandle[1] * height) / fittedHeight
			],
			outHandle: [
				(vertex.outHandle[0] * width) / fittedWidth,
				(vertex.outHandle[1] * height) / fittedHeight
			]
		})),
		transform: {
			...transform,
			x: centerX - canvasWidth / 2,
			y: centerY - canvasHeight / 2,
			width: fittedWidth,
			height: fittedHeight,
			anchorX: fittedWidth / 2,
			anchorY: fittedHeight / 2,
			aspectRatioLocked: false
		}
	};
}
