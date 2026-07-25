import type { StudioSelectionMode } from './types';

export interface SelectionPoint {
	x: number;
	y: number;
}

export interface SelectionBounds extends SelectionPoint {
	width: number;
	height: number;
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
	mode: StudioSelectionMode
): string[] {
	const uniqueCurrent = [...new Set(current)];
	const uniqueCandidates = [...new Set(candidates)];
	if (mode === 'replace') return uniqueCandidates;
	const candidateSet = new Set(uniqueCandidates);
	if (mode === 'subtract') return uniqueCurrent.filter((id) => !candidateSet.has(id));
	if (mode === 'add') {
		return [...uniqueCurrent, ...uniqueCandidates.filter((id) => !uniqueCurrent.includes(id))];
	}
	const toggled = uniqueCurrent.filter((id) => !candidateSet.has(id));
	return [...toggled, ...uniqueCandidates.filter((id) => !uniqueCurrent.includes(id))];
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
