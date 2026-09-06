import type { ShapePathVertex, TimelineItem } from '../project/types';
import {
	flattenShapePath,
	hasStrokeTaper,
	hasTrimPath,
	maximumTaperScale,
	renderShapeStroke
} from './stroke-path';

type ShapeContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ShapePathTarget = Pick<
	ShapeContext,
	| 'beginPath'
	| 'moveTo'
	| 'lineTo'
	| 'bezierCurveTo'
	| 'quadraticCurveTo'
	| 'closePath'
	| 'ellipse'
	| 'rect'
> & { roundRect?: (x: number, y: number, width: number, height: number, radius: number) => void };

interface Point {
	x: number;
	y: number;
}

const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function pointAtAngle(
	centerX: number,
	centerY: number,
	radiusX: number,
	radiusY: number,
	angle: number
): Point {
	return {
		x: centerX + Math.cos(angle) * radiusX,
		y: centerY + Math.sin(angle) * radiusY
	};
}

function distance(left: Point, right: Point): number {
	return Math.hypot(right.x - left.x, right.y - left.y);
}

function toward(from: Point, to: Point, amount: number): Point {
	const length = distance(from, to);
	if (length === 0) return from;
	const ratio = Math.min(1, amount / length);
	return {
		x: from.x + (to.x - from.x) * ratio,
		y: from.y + (to.y - from.y) * ratio
	};
}

function polygonPath(path: ShapePathTarget, vertices: Point[], radius: number): void {
	if (vertices.length < 3) return;
	if (radius <= 0) {
		path.moveTo(vertices[0]!.x, vertices[0]!.y);
		for (const vertex of vertices.slice(1)) path.lineTo(vertex.x, vertex.y);
		path.closePath();
		return;
	}

	const corners = vertices.map((vertex, index) => {
		const previous = vertices[(index - 1 + vertices.length) % vertices.length]!;
		const next = vertices[(index + 1) % vertices.length]!;
		const amount = Math.min(radius, distance(vertex, previous) / 2, distance(vertex, next) / 2);
		return {
			vertex,
			incoming: toward(vertex, previous, amount),
			outgoing: toward(vertex, next, amount)
		};
	});
	path.moveTo(corners[0]!.incoming.x, corners[0]!.incoming.y);
	for (const corner of corners) {
		path.quadraticCurveTo(corner.vertex.x, corner.vertex.y, corner.outgoing.x, corner.outgoing.y);
		const next = corners[(corners.indexOf(corner) + 1) % corners.length]!;
		path.lineTo(next.incoming.x, next.incoming.y);
	}
	path.closePath();
}

function regularVertices(
	count: number,
	centerX: number,
	centerY: number,
	radiusX: number,
	radiusY: number,
	innerRatio?: number
): Point[] {
	const vertexCount = innerRatio === undefined ? count : count * 2;
	return Array.from({ length: vertexCount }, (_, index) => {
		const radius = innerRatio !== undefined && index % 2 === 1 ? innerRatio : 1;
		return pointAtAngle(
			centerX,
			centerY,
			radiusX * radius,
			radiusY * radius,
			(index / vertexCount) * TAU - Math.PI / 2
		);
	});
}

function triangleVertices(
	direction: NonNullable<TimelineItem['shapeDirection']>,
	left: number,
	top: number,
	right: number,
	bottom: number
): Point[] {
	const centerX = (left + right) / 2;
	const centerY = (top + bottom) / 2;
	switch (direction) {
		case 'down':
			return [
				{ x: left, y: top },
				{ x: right, y: top },
				{ x: centerX, y: bottom }
			];
		case 'left':
			return [
				{ x: right, y: top },
				{ x: right, y: bottom },
				{ x: left, y: centerY }
			];
		case 'right':
			return [
				{ x: left, y: top },
				{ x: right, y: centerY },
				{ x: left, y: bottom }
			];
		case 'up':
		default:
			return [
				{ x: centerX, y: top },
				{ x: right, y: bottom },
				{ x: left, y: bottom }
			];
	}
}

function customPath(
	path: ShapePathTarget,
	vertices: ShapePathVertex[],
	width: number,
	height: number,
	closed: boolean
): void {
	const first = vertices[0];
	if (!first) return;
	path.moveTo(first.position[0] * width, first.position[1] * height);
	for (let index = 1; index < vertices.length; index++) {
		const previous = vertices[index - 1]!;
		const current = vertices[index]!;
		path.bezierCurveTo(
			(previous.position[0] + previous.outHandle[0]) * width,
			(previous.position[1] + previous.outHandle[1]) * height,
			(current.position[0] + current.inHandle[0]) * width,
			(current.position[1] + current.inHandle[1]) * height,
			current.position[0] * width,
			current.position[1] * height
		);
	}
	if (closed && vertices.length > 1) {
		const last = vertices.at(-1)!;
		path.bezierCurveTo(
			(last.position[0] + last.outHandle[0]) * width,
			(last.position[1] + last.outHandle[1]) * height,
			(first.position[0] + first.inHandle[0]) * width,
			(first.position[1] + first.inHandle[1]) * height,
			first.position[0] * width,
			first.position[1] * height
		);
		path.closePath();
	}
}

/** Build the exact local path used by preview, export, and masks. */
export function buildShapePath(
	path: ShapePathTarget,
	item: TimelineItem,
	width: number,
	height: number
): void {
	const strokeInset =
		item.strokeEnabled === false
			? 0
			: (Math.max(0, item.strokeWidth ?? 0) * maximumTaperScale(item)) / 2;
	const left = strokeInset;
	const top = strokeInset;
	const right = Math.max(left, width - strokeInset);
	const bottom = Math.max(top, height - strokeInset);
	const drawWidth = right - left;
	const drawHeight = bottom - top;
	const centerX = (left + right) / 2;
	const centerY = (top + bottom) / 2;
	const aspectLocked = item.transform?.aspectRatioLocked ?? true;
	const lockedRadius = Math.min(drawWidth, drawHeight) / 2;
	const radiusX = aspectLocked ? lockedRadius : drawWidth / 2;
	const radiusY = aspectLocked ? lockedRadius : drawHeight / 2;
	const cornerRadius = Math.max(0, item.shapeCornerRadius ?? 0);

	path.beginPath();
	switch (item.shapeType ?? 'rectangle') {
		case 'rectangle': {
			const radius = Math.min(cornerRadius, drawWidth / 2, drawHeight / 2);
			if (radius > 0 && path.roundRect) path.roundRect(left, top, drawWidth, drawHeight, radius);
			else if (radius > 0)
				polygonPath(
					path,
					[
						{ x: left, y: top },
						{ x: right, y: top },
						{ x: right, y: bottom },
						{ x: left, y: bottom }
					],
					radius
				);
			else path.rect(left, top, drawWidth, drawHeight);
			break;
		}
		case 'circle':
			path.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, TAU);
			break;
		case 'ellipse':
			path.ellipse(centerX, centerY, drawWidth / 2, drawHeight / 2, 0, 0, TAU);
			break;
		case 'triangle':
			polygonPath(
				path,
				triangleVertices(item.shapeDirection ?? 'up', left, top, right, bottom),
				cornerRadius
			);
			break;
		case 'star':
			polygonPath(
				path,
				regularVertices(
					clamp(Math.round(item.shapePoints ?? 5), 3, 64),
					centerX,
					centerY,
					radiusX,
					radiusY,
					clamp(item.shapeInnerRadius ?? 0.5, 0.05, 0.95)
				),
				cornerRadius
			);
			break;
		case 'polygon':
			polygonPath(
				path,
				regularVertices(
					clamp(Math.round(item.shapePoints ?? 6), 3, 64),
					centerX,
					centerY,
					radiusX,
					radiusY
				),
				cornerRadius
			);
			break;
		case 'heart': {
			const x = left;
			const y = top;
			path.moveTo(x + drawWidth / 2, y + drawHeight);
			path.bezierCurveTo(
				x + drawWidth * 0.42,
				y + drawHeight * 0.86,
				x,
				y + drawHeight * 0.62,
				x,
				y + drawHeight * 0.32
			);
			path.bezierCurveTo(
				x,
				y - drawHeight * 0.02,
				x + drawWidth * 0.42,
				y - drawHeight * 0.08,
				x + drawWidth / 2,
				y + drawHeight * 0.22
			);
			path.bezierCurveTo(
				x + drawWidth * 0.58,
				y - drawHeight * 0.08,
				x + drawWidth,
				y - drawHeight * 0.02,
				x + drawWidth,
				y + drawHeight * 0.32
			);
			path.bezierCurveTo(
				x + drawWidth,
				y + drawHeight * 0.62,
				x + drawWidth * 0.58,
				y + drawHeight * 0.86,
				x + drawWidth / 2,
				y + drawHeight
			);
			path.closePath();
			break;
		}
		case 'path':
			customPath(path, item.pathVertices ?? [], width, height, item.pathClosed !== false);
			break;
	}
}

function fillStyle(
	context: ShapeContext,
	item: TimelineItem,
	width: number,
	height: number
): string | CanvasGradient {
	if (item.fillType !== 'linear') return item.fillColor ?? '#f97316';
	const angle = ((item.gradientAngle ?? 0) * Math.PI) / 180;
	const centerX = width / 2;
	const centerY = height / 2;
	const extent = Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height;
	const offsetX = (Math.cos(angle) * extent) / 2;
	const offsetY = (Math.sin(angle) * extent) / 2;
	const gradient = context.createLinearGradient(
		centerX - offsetX,
		centerY - offsetY,
		centerX + offsetX,
		centerY + offsetY
	);
	gradient.addColorStop(0, item.gradientStartColor ?? item.fillColor ?? '#f97316');
	gradient.addColorStop(1, item.gradientEndColor ?? '#fb7185');
	return gradient;
}

/** Rasterize a shape inside its own bounds. Item transforms stay in the shared stack compositor. */
export function renderShapeItemRaster(
	context: ShapeContext,
	item: TimelineItem,
	width: number,
	height: number
): void {
	context.save();
	try {
		context.clearRect(0, 0, width, height);
		if (item.isMask) return;
		buildShapePath(context, item, width, height);
		const closedPath = item.shapeType !== 'path' || item.pathClosed !== false;
		if ((item.fillEnabled ?? true) && closedPath) {
			context.fillStyle = fillStyle(context, item, width, height);
			context.fill();
		}
		if ((item.strokeEnabled ?? false) && (item.strokeWidth ?? 0) > 0) {
			if (hasTrimPath(item) || hasStrokeTaper(item)) {
				const flattened = flattenShapePath((target) => buildShapePath(target, item, width, height));
				renderShapeStroke(context, flattened, item);
			} else {
				context.strokeStyle = item.strokeColor ?? '#ffffff';
				context.lineWidth = item.strokeWidth ?? 0;
				context.lineCap = item.strokeLineCap ?? 'butt';
				context.lineJoin = item.strokeLineJoin ?? 'miter';
				context.miterLimit = item.strokeMiterLimit ?? 4;
				context.stroke();
			}
		}
	} finally {
		context.restore();
	}
}
