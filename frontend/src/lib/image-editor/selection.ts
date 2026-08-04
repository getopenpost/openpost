import type { ImageEditorSelectionMode } from './types';

export interface SelectionPoint {
	x: number;
	y: number;
}

export interface SelectionBounds extends SelectionPoint {
	width: number;
	height: number;
}

export interface ImageEditorPixelSelection {
	width: number;
	height: number;
	data: Uint8Array;
	targetLayerIDs: string[];
}

export function normalizeSelectionBounds(
	start: SelectionPoint,
	end: SelectionPoint
): SelectionBounds {
	return {
		x: Math.min(start.x, end.x),
		y: Math.min(start.y, end.y),
		width: Math.abs(end.x - start.x),
		height: Math.abs(end.y - start.y)
	};
}

export function boundsIntersect(left: SelectionBounds, right: SelectionBounds): boolean {
	return (
		left.x <= right.x + right.width &&
		left.x + left.width >= right.x &&
		left.y <= right.y + right.height &&
		left.y + left.height >= right.y
	);
}

export function pointInPolygon(point: SelectionPoint, polygon: SelectionPoint[]): boolean {
	if (polygon.length < 3) return false;
	let inside = false;
	for (
		let current = 0, previous = polygon.length - 1;
		current < polygon.length;
		previous = current++
	) {
		const a = polygon[current];
		const b = polygon[previous];
		const crosses =
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
		if (crosses) inside = !inside;
	}
	return inside;
}

export function polygonIntersectsBounds(
	polygon: SelectionPoint[],
	bounds: SelectionBounds
): boolean {
	if (polygon.length < 3) return false;
	const corners = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		{ x: bounds.x, y: bounds.y + bounds.height }
	];
	if (corners.some((point) => pointInPolygon(point, polygon))) return true;
	if (
		polygon.some(
			(point) =>
				point.x >= bounds.x &&
				point.x <= bounds.x + bounds.width &&
				point.y >= bounds.y &&
				point.y <= bounds.y + bounds.height
		)
	) {
		return true;
	}
	const rectangleEdges = corners.map(
		(point, index) => [point, corners[(index + 1) % corners.length]] as const
	);
	for (let index = 0; index < polygon.length; index++) {
		const start = polygon[index];
		const end = polygon[(index + 1) % polygon.length];
		if (rectangleEdges.some(([a, b]) => segmentsIntersect(start, end, a, b))) return true;
	}
	return false;
}

export function mergeSelectionIDs(
	current: string[],
	candidates: string[],
	mode: ImageEditorSelectionMode
): string[] {
	const uniqueCurrent = [...new Set(current)];
	const uniqueCandidates = [...new Set(candidates)];
	if (mode === 'replace') return uniqueCandidates;
	const candidateSet = new Set(uniqueCandidates);
	if (mode === 'subtract') return uniqueCurrent.filter((id) => !candidateSet.has(id));
	if (mode === 'intersect') return uniqueCurrent.filter((id) => candidateSet.has(id));
	if (mode === 'add') {
		return [...uniqueCurrent, ...uniqueCandidates.filter((id) => !uniqueCurrent.includes(id))];
	}
	const toggled = uniqueCurrent.filter((id) => !candidateSet.has(id));
	return [...toggled, ...uniqueCandidates.filter((id) => !uniqueCurrent.includes(id))];
}

export function rectanglePixelMask(
	width: number,
	height: number,
	bounds: SelectionBounds
): Uint8Array {
	const mask = new Uint8Array(width * height);
	const startX = clampInteger(Math.floor(bounds.x), 0, width);
	const endX = clampInteger(Math.ceil(bounds.x + bounds.width), 0, width);
	const startY = clampInteger(Math.floor(bounds.y), 0, height);
	const endY = clampInteger(Math.ceil(bounds.y + bounds.height), 0, height);
	for (let y = startY; y < endY; y++) {
		mask.fill(1, y * width + startX, y * width + endX);
	}
	return mask;
}

export function ellipsePixelMask(
	width: number,
	height: number,
	bounds: SelectionBounds
): Uint8Array {
	const mask = new Uint8Array(width * height);
	const radiusX = Math.max(0.5, bounds.width / 2);
	const radiusY = Math.max(0.5, bounds.height / 2);
	const centerX = bounds.x + radiusX;
	const centerY = bounds.y + radiusY;
	const startX = clampInteger(Math.floor(bounds.x), 0, width);
	const endX = clampInteger(Math.ceil(bounds.x + bounds.width), 0, width);
	const startY = clampInteger(Math.floor(bounds.y), 0, height);
	const endY = clampInteger(Math.ceil(bounds.y + bounds.height), 0, height);
	for (let y = startY; y < endY; y++) {
		for (let x = startX; x < endX; x++) {
			const normalizedX = (x + 0.5 - centerX) / radiusX;
			const normalizedY = (y + 0.5 - centerY) / radiusY;
			if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
				mask[y * width + x] = 1;
			}
		}
	}
	return mask;
}

export function polygonPixelMask(
	width: number,
	height: number,
	points: SelectionPoint[]
): Uint8Array {
	const mask = new Uint8Array(width * height);
	if (points.length < 3) return mask;
	const bounds = points.reduce(
		(result, point) => ({
			minX: Math.min(result.minX, point.x),
			minY: Math.min(result.minY, point.y),
			maxX: Math.max(result.maxX, point.x),
			maxY: Math.max(result.maxY, point.y)
		}),
		{ minX: width, minY: height, maxX: 0, maxY: 0 }
	);
	const startX = clampInteger(Math.floor(bounds.minX), 0, width);
	const endX = clampInteger(Math.ceil(bounds.maxX), 0, width);
	const startY = clampInteger(Math.floor(bounds.minY), 0, height);
	const endY = clampInteger(Math.ceil(bounds.maxY), 0, height);
	for (let y = startY; y < endY; y++) {
		for (let x = startX; x < endX; x++) {
			if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, points)) mask[y * width + x] = 1;
		}
	}
	return mask;
}

export function strokePixelMask(
	width: number,
	height: number,
	points: SelectionPoint[],
	size: number,
	roughness = 0
): Uint8Array {
	const mask = new Uint8Array(width * height);
	if (points.length === 0) return mask;
	const radius = Math.max(0.5, size / 2);
	const stamp = (point: SelectionPoint): void => {
		const startX = clampInteger(Math.floor(point.x - radius), 0, width);
		const endX = clampInteger(Math.ceil(point.x + radius), 0, width);
		const startY = clampInteger(Math.floor(point.y - radius), 0, height);
		const endY = clampInteger(Math.ceil(point.y + radius), 0, height);
		for (let y = startY; y < endY; y++) {
			for (let x = startX; x < endX; x++) {
				if (Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y) <= radius) {
					mask[y * width + x] = 1;
				}
			}
		}
	};
	stamp(points[0]);
	for (let index = 1; index < points.length; index++) {
		const start = points[index - 1];
		const end = points[index];
		const distance = Math.hypot(end.x - start.x, end.y - start.y);
		const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.45)));
		for (let step = 1; step <= steps; step++) {
			const ratio = step / steps;
			stamp({
				x: start.x + (end.x - start.x) * ratio,
				y: start.y + (end.y - start.y) * ratio
			});
		}
	}
	const texture = Math.max(0, Math.min(1, roughness));
	if (texture > 0) {
		const hardMask = mask.slice();
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const index = y * width + x;
				if (!hardMask[index]) continue;
				const edge =
					x === 0 ||
					y === 0 ||
					x + 1 === width ||
					y + 1 === height ||
					!hardMask[index - 1] ||
					!hardMask[index + 1] ||
					!hardMask[index - width] ||
					!hardMask[index + width];
				if (edge && pixelNoise(x, y) < texture * 0.72) mask[index] = 0;
			}
		}
	}
	return mask;
}

export function pixelMaskContainsPoint(
	mask: Uint8Array,
	width: number,
	height: number,
	point: SelectionPoint
): boolean {
	const x = Math.floor(point.x);
	const y = Math.floor(point.y);
	return x >= 0 && x < width && y >= 0 && y < height && Boolean(mask[y * width + x]);
}

export function translatePixelMask(
	mask: Uint8Array,
	width: number,
	height: number,
	deltaX: number,
	deltaY: number
): Uint8Array {
	const translated = new Uint8Array(width * height);
	const offsetX = Math.round(deltaX);
	const offsetY = Math.round(deltaY);
	for (let y = 0; y < height; y++) {
		const targetY = y + offsetY;
		if (targetY < 0 || targetY >= height) continue;
		for (let x = 0; x < width; x++) {
			if (!mask[y * width + x]) continue;
			const targetX = x + offsetX;
			if (targetX >= 0 && targetX < width) translated[targetY * width + targetX] = 1;
		}
	}
	return translated;
}

export function magicPixelMask(
	image: { width: number; height: number; data: Uint8ClampedArray },
	point: SelectionPoint,
	tolerance: number,
	contiguous = true
): Uint8Array {
	const { width, height, data } = image;
	const mask = new Uint8Array(width * height);
	const startX = clampInteger(Math.floor(point.x), 0, width - 1);
	const startY = clampInteger(Math.floor(point.y), 0, height - 1);
	const startIndex = startY * width + startX;
	const sampleOffset = startIndex * 4;
	const sample = [
		data[sampleOffset],
		data[sampleOffset + 1],
		data[sampleOffset + 2],
		data[sampleOffset + 3]
	];
	const threshold = Math.max(0, Math.min(255, tolerance));
	const matches = (index: number): boolean => {
		const offset = index * 4;
		return (
			Math.max(
				Math.abs(data[offset] - sample[0]),
				Math.abs(data[offset + 1] - sample[1]),
				Math.abs(data[offset + 2] - sample[2]),
				Math.abs(data[offset + 3] - sample[3])
			) <= threshold
		);
	};
	if (!contiguous) {
		for (let index = 0; index < mask.length; index++) {
			if (matches(index)) mask[index] = 1;
		}
		return mask;
	}
	const visited = new Uint8Array(width * height);
	const queue = new Uint32Array(width * height);
	let read = 0;
	let write = 0;
	queue[write++] = startIndex;
	visited[startIndex] = 1;
	while (read < write) {
		const index = queue[read++];
		if (!matches(index)) continue;
		mask[index] = 1;
		const x = index % width;
		const y = Math.floor(index / width);
		for (const neighbor of [
			x > 0 ? index - 1 : -1,
			x + 1 < width ? index + 1 : -1,
			y > 0 ? index - width : -1,
			y + 1 < height ? index + width : -1
		]) {
			if (neighbor < 0 || visited[neighbor]) continue;
			visited[neighbor] = 1;
			queue[write++] = neighbor;
		}
	}
	return mask;
}

export function combinePixelMasks(
	current: Uint8Array | null,
	incoming: Uint8Array,
	mode: ImageEditorSelectionMode
): Uint8Array {
	if (!current || current.length !== incoming.length || mode === 'replace') {
		return incoming.slice();
	}
	const combined = current.slice();
	for (let index = 0; index < combined.length; index++) {
		if (mode === 'add') combined[index] = current[index] || incoming[index] ? 1 : 0;
		else if (mode === 'subtract') combined[index] = current[index] && !incoming[index] ? 1 : 0;
		else if (mode === 'intersect') combined[index] = current[index] && incoming[index] ? 1 : 0;
		else combined[index] = Boolean(current[index]) !== Boolean(incoming[index]) ? 1 : 0;
	}
	return combined;
}

export function intersectPixelMasks(left: Uint8Array, right: Uint8Array): Uint8Array {
	const result = new Uint8Array(Math.min(left.length, right.length));
	for (let index = 0; index < result.length; index++) {
		result[index] = left[index] && right[index] ? 1 : 0;
	}
	return result;
}

export function subtractPixelMasks(left: Uint8Array, right: Uint8Array): Uint8Array {
	const result = left.slice();
	for (let index = 0; index < result.length; index++) {
		if (right[index]) result[index] = 0;
	}
	return result;
}

export function pixelSpansToMask(
	spans: Array<{ x: number; y: number; width: number }>,
	width: number,
	height: number
): Uint8Array {
	const mask = new Uint8Array(width * height);
	for (const span of spans) {
		const y = Math.floor(span.y);
		if (y < 0 || y >= height) continue;
		const start = clampInteger(Math.floor(span.x), 0, width);
		const end = clampInteger(Math.ceil(span.x + span.width), 0, width);
		if (end > start) mask.fill(1, y * width + start, y * width + end);
	}
	return mask;
}

export function pixelMaskBounds(
	mask: Uint8Array,
	width: number,
	height: number
): SelectionBounds | null {
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let index = 0; index < mask.length; index++) {
		if (!mask[index]) continue;
		const x = index % width;
		const y = Math.floor(index / width);
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function pixelMaskToSpans(
	mask: Uint8Array,
	width: number,
	height: number,
	offsetX = 0,
	offsetY = 0
): Array<{ x: number; y: number; width: number }> {
	const spans: Array<{ x: number; y: number; width: number }> = [];
	for (let y = 0; y < height; y++) {
		let x = 0;
		while (x < width) {
			while (x < width && !mask[y * width + x]) x++;
			if (x >= width) break;
			const start = x;
			while (x < width && mask[y * width + x]) x++;
			spans.push({ x: start - offsetX, y: y - offsetY, width: x - start });
		}
	}
	return spans;
}

export function colorsWithinTolerance(
	left: string,
	right: string,
	tolerancePercent: number
): boolean {
	const leftRGB = parseHexColor(left);
	const rightRGB = parseHexColor(right);
	if (!leftRGB || !rightRGB) return false;
	const distance = Math.hypot(
		leftRGB.red - rightRGB.red,
		leftRGB.green - rightRGB.green,
		leftRGB.blue - rightRGB.blue
	);
	const normalizedDistance = (distance / Math.hypot(255, 255, 255)) * 100;
	return normalizedDistance <= Math.max(0, Math.min(100, tolerancePercent));
}

function clampInteger(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.trunc(value)));
}

function pixelNoise(x: number, y: number): number {
	let value = Math.imul(x + 1, 374_761_393) ^ Math.imul(y + 1, 668_265_263);
	value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
	return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}

function parseHexColor(value: string): { red: number; green: number; blue: number } | null {
	const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim());
	if (!match) return null;
	let hex = match[1];
	if (hex.length <= 4) hex = [...hex].map((character) => character + character).join('');
	return {
		red: Number.parseInt(hex.slice(0, 2), 16),
		green: Number.parseInt(hex.slice(2, 4), 16),
		blue: Number.parseInt(hex.slice(4, 6), 16)
	};
}

function segmentsIntersect(
	firstStart: SelectionPoint,
	firstEnd: SelectionPoint,
	secondStart: SelectionPoint,
	secondEnd: SelectionPoint
): boolean {
	const direction = (a: SelectionPoint, b: SelectionPoint, c: SelectionPoint): number =>
		(b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	const onSegment = (a: SelectionPoint, b: SelectionPoint, point: SelectionPoint): boolean =>
		point.x >= Math.min(a.x, b.x) &&
		point.x <= Math.max(a.x, b.x) &&
		point.y >= Math.min(a.y, b.y) &&
		point.y <= Math.max(a.y, b.y);
	const firstDirection = direction(firstStart, firstEnd, secondStart);
	const secondDirection = direction(firstStart, firstEnd, secondEnd);
	const thirdDirection = direction(secondStart, secondEnd, firstStart);
	const fourthDirection = direction(secondStart, secondEnd, firstEnd);
	if (
		((firstDirection > 0 && secondDirection < 0) || (firstDirection < 0 && secondDirection > 0)) &&
		((thirdDirection > 0 && fourthDirection < 0) || (thirdDirection < 0 && fourthDirection > 0))
	) {
		return true;
	}
	const epsilon = 0.000001;
	return (
		(Math.abs(firstDirection) < epsilon && onSegment(firstStart, firstEnd, secondStart)) ||
		(Math.abs(secondDirection) < epsilon && onSegment(firstStart, firstEnd, secondEnd)) ||
		(Math.abs(thirdDirection) < epsilon && onSegment(secondStart, secondEnd, firstStart)) ||
		(Math.abs(fourthDirection) < epsilon && onSegment(secondStart, secondEnd, firstEnd))
	);
}
