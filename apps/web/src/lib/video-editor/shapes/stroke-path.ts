/**
 * Arc-length-aware trim paths and variable-width stroke tapers.
 *
 * The taper math follows FreeCut's MIT-licensed shared shape helpers, adapted
 * to the Canvas2D path used by both OpenPost preview and export.
 */

import type { TimelineItem } from '../project/types';
import type { ShapePathTarget } from './render';

interface Point {
	x: number;
	y: number;
}

export interface FlattenedPathPoint extends Point {
	/** Normalized cumulative arc length. */
	progress: number;
}

export interface FlattenedShapePath {
	points: FlattenedPathPoint[];
	totalLength: number;
	closed: boolean;
}

export interface ShapeStrokeContext {
	arc(
		x: number,
		y: number,
		radius: number,
		startAngle: number,
		endAngle: number,
		counterclockwise?: boolean
	): void;
	beginPath(): void;
	closePath(): void;
	fill(): void;
	fillStyle: string | CanvasGradient | CanvasPattern;
	lineCap: CanvasLineCap;
	lineJoin: CanvasLineJoin;
	lineTo(x: number, y: number): void;
	lineWidth: number;
	miterLimit: number;
	moveTo(x: number, y: number): void;
	stroke(): void;
	strokeStyle: string | CanvasGradient | CanvasPattern;
}
type RawPoint = [number, number];

const DEFAULT_FLATNESS_TOLERANCE = 0.35;
const MAX_SUBDIVISION_DEPTH = 12;

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value: number): number {
	return clamp(value, 0, 1);
}

function wrap01(value: number): number {
	return ((value % 1) + 1) % 1;
}

function midpoint(a: RawPoint, b: RawPoint): RawPoint {
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pointLineDistance(point: RawPoint, start: RawPoint, end: RawPoint): number {
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const denominator = Math.hypot(dx, dy);
	if (denominator <= Number.EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
	return (
		Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / denominator
	);
}

function flattenCubic(
	p0: RawPoint,
	p1: RawPoint,
	p2: RawPoint,
	p3: RawPoint,
	tolerance: number,
	output: RawPoint[],
	depth = 0
): void {
	const flatness = Math.max(pointLineDistance(p1, p0, p3), pointLineDistance(p2, p0, p3));
	if (flatness <= tolerance || depth >= MAX_SUBDIVISION_DEPTH) {
		output.push(p3);
		return;
	}
	const p01 = midpoint(p0, p1);
	const p12 = midpoint(p1, p2);
	const p23 = midpoint(p2, p3);
	const p012 = midpoint(p01, p12);
	const p123 = midpoint(p12, p23);
	const split = midpoint(p012, p123);
	flattenCubic(p0, p01, p012, split, tolerance, output, depth + 1);
	flattenCubic(split, p123, p23, p3, tolerance, output, depth + 1);
}

function samePoint(a: RawPoint | undefined, b: RawPoint | undefined): boolean {
	return Boolean(a && b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7);
}

/** Record the shared Canvas path builder into an adaptive polyline. */
export function flattenShapePath(
	build: (target: ShapePathTarget) => void,
	tolerance = DEFAULT_FLATNESS_TOLERANCE
): FlattenedShapePath {
	let points: RawPoint[] = [];
	let current: RawPoint | undefined;
	let first: RawPoint | undefined;
	let closed = false;
	const push = (point: RawPoint) => {
		if (!samePoint(points.at(-1), point)) points.push(point);
		current = point;
	};
	const moveTo = (x: number, y: number) => {
		first = [x, y];
		push(first);
	};
	const lineTo = (x: number, y: number) => {
		if (!current) return moveTo(x, y);
		push([x, y]);
	};
	const bezierCurveTo = (
		cp1x: number,
		cp1y: number,
		cp2x: number,
		cp2y: number,
		x: number,
		y: number
	) => {
		if (!current) return moveTo(x, y);
		const output: RawPoint[] = [];
		flattenCubic(current, [cp1x, cp1y], [cp2x, cp2y], [x, y], Math.max(0.01, tolerance), output);
		for (const point of output) push(point);
	};
	const quadraticCurveTo = (cpx: number, cpy: number, x: number, y: number) => {
		if (!current) return moveTo(x, y);
		const start = current;
		bezierCurveTo(
			start[0] + (2 / 3) * (cpx - start[0]),
			start[1] + (2 / 3) * (cpy - start[1]),
			x + (2 / 3) * (cpx - x),
			y + (2 / 3) * (cpy - y),
			x,
			y
		);
	};
	const closePath = () => {
		if (first && !samePoint(points.at(-1), first)) points.push([...first]);
		current = first;
		closed = true;
	};
	const ellipse = (
		x: number,
		y: number,
		radiusX: number,
		radiusY: number,
		rotation: number,
		startAngle: number,
		endAngle: number,
		counterclockwise = false
	) => {
		let sweep = endAngle - startAngle;
		if (!counterclockwise && sweep < 0) sweep += Math.PI * 2;
		if (counterclockwise && sweep > 0) sweep -= Math.PI * 2;
		if (Math.abs(sweep) >= Math.PI * 2 - 1e-7)
			sweep = counterclockwise ? -Math.PI * 2 : Math.PI * 2;
		const steps = clamp(Math.ceil((Math.abs(sweep) * Math.max(radiusX, radiusY)) / 2), 16, 512);
		const cosRotation = Math.cos(rotation);
		const sinRotation = Math.sin(rotation);
		for (let index = 0; index <= steps; index++) {
			const angle = startAngle + (sweep * index) / steps;
			const localX = Math.cos(angle) * radiusX;
			const localY = Math.sin(angle) * radiusY;
			const point: RawPoint = [
				x + localX * cosRotation - localY * sinRotation,
				y + localX * sinRotation + localY * cosRotation
			];
			if (index === 0 && !current) moveTo(...point);
			else lineTo(...point);
		}
	};
	const rect = (x: number, y: number, width: number, height: number) => {
		moveTo(x, y);
		lineTo(x + width, y);
		lineTo(x + width, y + height);
		lineTo(x, y + height);
		closePath();
	};
	const roundRect = (x: number, y: number, width: number, height: number, radiusValue = 0) => {
		const radius = clamp(radiusValue, 0, Math.min(Math.abs(width), Math.abs(height)) / 2);
		if (radius <= 0) return rect(x, y, width, height);
		moveTo(x + radius, y);
		lineTo(x + width - radius, y);
		quadraticCurveTo(x + width, y, x + width, y + radius);
		lineTo(x + width, y + height - radius);
		quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		lineTo(x + radius, y + height);
		quadraticCurveTo(x, y + height, x, y + height - radius);
		lineTo(x, y + radius);
		quadraticCurveTo(x, y, x + radius, y);
		closePath();
	};

	build({
		beginPath() {
			points = [];
			current = undefined;
			first = undefined;
			closed = false;
		},
		moveTo,
		lineTo,
		bezierCurveTo,
		quadraticCurveTo,
		closePath,
		ellipse,
		rect,
		roundRect
	});

	const cumulative = [0];
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1]!;
		const point = points[index]!;
		cumulative.push(
			cumulative[index - 1]! + Math.hypot(point[0] - previous[0], point[1] - previous[1])
		);
	}
	const totalLength = cumulative.at(-1) ?? 0;
	return {
		points: points.map(([x, y], index) => ({
			x,
			y,
			progress: totalLength > 0 ? cumulative[index]! / totalLength : 0
		})),
		totalLength,
		closed
	};
}

interface VisibleRange {
	start: number;
	length: number;
	visibleProgressStart: number;
}

function trimStart(item: TimelineItem): number {
	return clamp01((item.trimPathStart ?? 0) / 100);
}

function trimEnd(item: TimelineItem): number {
	return clamp01((item.trimPathEnd ?? 100) / 100);
}

function visibleRanges(path: FlattenedShapePath, item: TimelineItem): VisibleRange[] {
	const start = trimStart(item);
	const end = trimEnd(item);
	if (start === 0 && end === 1) return [{ start: 0, length: 1, visibleProgressStart: 0 }];
	const length = wrap01(end - start);
	if (length <= 0) return [];
	const shiftedStart = wrap01(start + (item.trimPathOffset ?? 0) / 360);
	if (path.closed || shiftedStart + length <= 1)
		return [{ start: shiftedStart, length, visibleProgressStart: 0 }];
	const firstLength = 1 - shiftedStart;
	return [
		{ start: shiftedStart, length: firstLength, visibleProgressStart: 0 },
		{
			start: 0,
			length: length - firstLength,
			visibleProgressStart: firstLength / length
		}
	];
}

function pointAtProgress(points: FlattenedPathPoint[], progress: number): FlattenedPathPoint {
	const target = clamp01(progress);
	if (target <= 0) return { ...points[0]!, progress: target };
	if (target >= 1) return { ...points.at(-1)!, progress: target };
	let low = 0;
	let high = points.length - 1;
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2);
		if (points[middle]!.progress < target) low = middle;
		else high = middle;
	}
	const from = points[low]!;
	const to = points[high]!;
	const span = Math.max(Number.EPSILON, to.progress - from.progress);
	const amount = (target - from.progress) / span;
	return {
		x: from.x + (to.x - from.x) * amount,
		y: from.y + (to.y - from.y) * amount,
		progress: target
	};
}

function sampledCenterlines(path: FlattenedShapePath, item: TimelineItem): FlattenedPathPoint[][] {
	const ranges = visibleRanges(path, item);
	const totalVisibleLength = ranges.reduce((sum, range) => sum + range.length, 0);
	if (totalVisibleLength <= 0) return [];
	const totalSampleCount = Math.max(48, Math.min(256, Math.ceil(path.totalLength / 2)));
	return ranges.map((range) => {
		const sampleCount = Math.max(
			2,
			Math.ceil(totalSampleCount * (range.length / totalVisibleLength))
		);
		return Array.from({ length: sampleCount + 1 }, (_, index) => {
			const rangeProgress = index / sampleCount;
			const visibleProgress =
				range.visibleProgressStart + (rangeProgress * range.length) / totalVisibleLength;
			const pathProgress = range.start + rangeProgress * range.length;
			const point = pointAtProgress(path.points, path.closed ? wrap01(pathProgress) : pathProgress);
			return { ...point, progress: visibleProgress };
		});
	});
}

export function hasTrimPath(item: TimelineItem): boolean {
	return trimStart(item) !== 0 || trimEnd(item) !== 1;
}

export function hasStrokeTaper(item: TimelineItem): boolean {
	return (
		((item.taperStartLength ?? 0) > 0 && (item.taperStartWidth ?? 100) !== 100) ||
		((item.taperEndLength ?? 0) > 0 && (item.taperEndWidth ?? 100) !== 100)
	);
}

export function maximumTaperScale(item: TimelineItem): number {
	if (!hasStrokeTaper(item)) return 1;
	return Math.max(
		1,
		(item.taperStartLength ?? 0) > 0 ? clamp(item.taperStartWidth ?? 100, 0, 200) / 100 : 1,
		(item.taperEndLength ?? 0) > 0 ? clamp(item.taperEndWidth ?? 100, 0, 200) / 100 : 1
	);
}

export function taperWidthScale(progress: number, item: TimelineItem): number {
	const position = clamp(progress * 100, 0, 100);
	const startLength = clamp(item.taperStartLength ?? 0, 0, 100);
	const endLength = clamp(item.taperEndLength ?? 0, 0, 100);
	const startWidth = clamp(item.taperStartWidth ?? 100, 0, 200) / 100;
	const endWidth = clamp(item.taperEndWidth ?? 100, 0, 200) / 100;
	const startScale =
		startLength > 0 && position < startLength
			? startWidth + (1 - startWidth) * (position / startLength)
			: 1;
	const distanceFromEnd = 100 - position;
	const endScale =
		endLength > 0 && distanceFromEnd < endLength
			? endWidth + (1 - endWidth) * (distanceFromEnd / endLength)
			: 1;
	return startScale * endScale;
}

function normalize(dx: number, dy: number): [number, number] {
	const length = Math.hypot(dx, dy);
	return length > Number.EPSILON ? [dx / length, dy / length] : [1, 0];
}

function drawUniformStroke(
	context: ShapeStrokeContext,
	path: FlattenedShapePath,
	item: TimelineItem
): void {
	for (const centerline of sampledCenterlines(path, item)) {
		const first = centerline[0];
		if (!first) continue;
		context.beginPath();
		context.moveTo(first.x, first.y);
		for (const point of centerline.slice(1)) context.lineTo(point.x, point.y);
		if (path.closed && !hasTrimPath(item)) context.closePath();
		context.stroke();
	}
}

function drawTaperedStroke(
	context: ShapeStrokeContext,
	path: FlattenedShapePath,
	item: TimelineItem,
	strokeWidth: number
): void {
	context.beginPath();
	let drew = false;
	for (const centerline of sampledCenterlines(path, item)) {
		if (centerline.length < 2) continue;
		const left: Point[] = [];
		const right: Point[] = [];
		const radii: number[] = [];
		const lastIndex = centerline.length - 1;
		for (let index = 0; index < centerline.length; index++) {
			const point = centerline[index]!;
			const previous = centerline[Math.max(0, index - 1)]!;
			const next = centerline[Math.min(lastIndex, index + 1)]!;
			const [tx, ty] = normalize(next.x - previous.x, next.y - previous.y);
			const radius = (strokeWidth * taperWidthScale(point.progress, item)) / 2;
			const squareOffset =
				item.strokeLineCap === 'square'
					? index === 0
						? -radius
						: index === lastIndex
							? radius
							: 0
					: 0;
			const x = point.x + tx * squareOffset;
			const y = point.y + ty * squareOffset;
			left.push({ x: x - ty * radius, y: y + tx * radius });
			right.push({ x: x + ty * radius, y: y - tx * radius });
			radii.push(radius);
		}
		const firstLeft = left[0]!;
		context.moveTo(firstLeft.x, firstLeft.y);
		for (const point of left.slice(1)) context.lineTo(point.x, point.y);
		for (const point of right.reverse()) context.lineTo(point.x, point.y);
		context.closePath();
		if (item.strokeLineCap === 'round') {
			const first = centerline[0]!;
			const last = centerline.at(-1)!;
			if (radii[0]! > 0) {
				context.moveTo(first.x + radii[0]!, first.y);
				context.arc(first.x, first.y, radii[0]!, 0, Math.PI * 2);
			}
			if (radii.at(-1)! > 0) {
				context.moveTo(last.x + radii.at(-1)!, last.y);
				context.arc(last.x, last.y, radii.at(-1)!, 0, Math.PI * 2);
			}
		}
		drew = true;
	}
	if (drew) context.fill();
}

/** Draw only the shape stroke after the full fill path has been painted. */
export function renderShapeStroke(
	context: ShapeStrokeContext,
	path: FlattenedShapePath,
	item: TimelineItem
): void {
	const strokeWidth = Math.max(0, item.strokeWidth ?? 0);
	if (strokeWidth <= 0 || path.points.length < 2 || path.totalLength <= 0) return;
	context.strokeStyle = item.strokeColor ?? '#ffffff';
	context.fillStyle = item.strokeColor ?? '#ffffff';
	context.lineWidth = strokeWidth;
	context.lineCap = item.strokeLineCap ?? 'butt';
	context.lineJoin = item.strokeLineJoin ?? 'miter';
	context.miterLimit = item.strokeMiterLimit ?? 4;
	if (hasStrokeTaper(item)) drawTaperedStroke(context, path, item, strokeWidth);
	else drawUniformStroke(context, path, item);
}
