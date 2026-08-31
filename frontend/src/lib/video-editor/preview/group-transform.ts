/** Pure multi-item canvas transform geometry. */
import type { ItemTransform } from '$lib/video-editor/project/types';
import {
	applyCanvasMoveSnapping,
	applyCanvasResizeSnapping,
	type CanvasSnapLine
} from './canvas-snapping';

export type GroupTransform = Required<
	Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>
> &
	ItemTransform;

export interface Point {
	x: number;
	y: number;
}

export interface GroupBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface GroupTransformState {
	center: Point;
	bounds: GroupBounds;
	transforms: ReadonlyMap<string, GroupTransform>;
}

export type GroupAlignment =
	| 'left'
	| 'center-horizontal'
	| 'right'
	| 'top'
	| 'center-vertical'
	| 'bottom'
	| 'distribute-horizontal'
	| 'distribute-vertical';

export const GROUP_TRANSFORM_PROPERTIES = [
	'x',
	'y',
	'width',
	'height',
	'anchorX',
	'anchorY',
	'rotation'
] as const;
export type GroupTransformProperty = (typeof GROUP_TRANSFORM_PROPERTIES)[number];
export interface GroupTransformValues {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	anchorX?: number;
	anchorY?: number;
	rotation?: number;
}

export interface GroupTranslationSnapResult {
	deltaX: number;
	deltaY: number;
	snapLines: CanvasSnapLine[];
}

export interface GroupScaleSnapResult {
	scale: number;
	snapLines: CanvasSnapLine[];
}

export const MIN_GROUP_ITEM_SIZE = 20;

export function changedGroupTransformValues(
	current: GroupTransform,
	next: GroupTransform,
	epsilon = 0.000001
): GroupTransformValues {
	const changed: GroupTransformValues = {};
	for (const property of GROUP_TRANSFORM_PROPERTIES) {
		const currentValue =
			property === 'anchorX'
				? (current.anchorX ?? current.width / 2)
				: property === 'anchorY'
					? (current.anchorY ?? current.height / 2)
					: current[property];
		const nextValue =
			property === 'anchorX'
				? (next.anchorX ?? next.width / 2)
				: property === 'anchorY'
					? (next.anchorY ?? next.height / 2)
					: next[property];
		if (Math.abs(nextValue - currentValue) > epsilon) changed[property] = nextValue;
	}
	return changed;
}

function rotate(point: Point, degrees: number): Point {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return {
		x: point.x * cosine - point.y * sine,
		y: point.x * sine + point.y * cosine
	};
}

function itemAnchor(transform: GroupTransform, canvasWidth: number, canvasHeight: number): Point {
	return { x: canvasWidth / 2 + transform.x, y: canvasHeight / 2 + transform.y };
}

function scaledLocalPoint(point: Point, transform: GroupTransform): Point {
	return {
		x: point.x * (transform.scaleX ?? 1),
		y: point.y * (transform.scaleY ?? 1)
	};
}

export function groupItemBounds(
	transform: GroupTransform,
	canvasWidth: number,
	canvasHeight: number
): GroupBounds {
	const anchor = itemAnchor(transform, canvasWidth, canvasHeight);
	const anchorX = transform.anchorX ?? transform.width / 2;
	const anchorY = transform.anchorY ?? transform.height / 2;
	const localCorners = [
		{ x: -anchorX, y: -anchorY },
		{ x: transform.width - anchorX, y: -anchorY },
		{ x: transform.width - anchorX, y: transform.height - anchorY },
		{ x: -anchorX, y: transform.height - anchorY }
	];
	const corners = localCorners.map((corner) => {
		const rotated = rotate(scaledLocalPoint(corner, transform), transform.rotation);
		return { x: anchor.x + rotated.x, y: anchor.y + rotated.y };
	});
	const left = Math.min(...corners.map((corner) => corner.x));
	const top = Math.min(...corners.map((corner) => corner.y));
	const right = Math.max(...corners.map((corner) => corner.x));
	const bottom = Math.max(...corners.map((corner) => corner.y));
	return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function calculateGroupBounds(
	transforms: ReadonlyMap<string, GroupTransform>,
	canvasWidth: number,
	canvasHeight: number
): GroupBounds {
	const itemBounds = [...transforms.values()].map((transform) =>
		groupItemBounds(transform, canvasWidth, canvasHeight)
	);
	if (itemBounds.length === 0) {
		return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
	const left = Math.min(...itemBounds.map((bounds) => bounds.left));
	const top = Math.min(...itemBounds.map((bounds) => bounds.top));
	const right = Math.max(...itemBounds.map((bounds) => bounds.right));
	const bottom = Math.max(...itemBounds.map((bounds) => bounds.bottom));
	return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function initializeGroupTransform(
	transforms: ReadonlyMap<string, GroupTransform>,
	canvasWidth: number,
	canvasHeight: number
): GroupTransformState {
	const bounds = calculateGroupBounds(transforms, canvasWidth, canvasHeight);
	return {
		bounds,
		center: { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		transforms: new Map(transforms)
	};
}

export function translateGroup(
	state: GroupTransformState,
	deltaX: number,
	deltaY: number
): Map<string, GroupTransform> {
	return new Map(
		[...state.transforms].map(([id, transform]) => [
			id,
			{ ...transform, x: transform.x + deltaX, y: transform.y + deltaY }
		])
	);
}

export function scaleGroup(
	state: GroupTransformState,
	scale: number,
	canvasWidth: number,
	canvasHeight: number
): Map<string, GroupTransform> {
	const finiteScale = Number.isFinite(scale) ? scale : 1;
	const minimumScale = Math.max(
		...[...state.transforms.values()].flatMap((transform) => [
			MIN_GROUP_ITEM_SIZE / transform.width,
			MIN_GROUP_ITEM_SIZE / transform.height
		])
	);
	const appliedScale = Math.max(minimumScale, finiteScale);
	return new Map(
		[...state.transforms].map(([id, transform]) => {
			const anchor = itemAnchor(transform, canvasWidth, canvasHeight);
			const nextAnchor = {
				x: state.center.x + (anchor.x - state.center.x) * appliedScale,
				y: state.center.y + (anchor.y - state.center.y) * appliedScale
			};
			return [
				id,
				{
					...transform,
					x: nextAnchor.x - canvasWidth / 2,
					y: nextAnchor.y - canvasHeight / 2,
					width: transform.width * appliedScale,
					height: transform.height * appliedScale,
					anchorX: (transform.anchorX ?? transform.width / 2) * appliedScale,
					anchorY: (transform.anchorY ?? transform.height / 2) * appliedScale
				}
			];
		})
	);
}

function normalizeRotation(rotation: number): number {
	let normalized = rotation;
	while (normalized > 180) normalized -= 360;
	while (normalized < -180) normalized += 360;
	return normalized;
}

export function rotateGroup(
	state: GroupTransformState,
	deltaDegrees: number,
	canvasWidth: number,
	canvasHeight: number
): Map<string, GroupTransform> {
	return new Map(
		[...state.transforms].map(([id, transform]) => {
			const anchor = itemAnchor(transform, canvasWidth, canvasHeight);
			const rotatedOffset = rotate(
				{ x: anchor.x - state.center.x, y: anchor.y - state.center.y },
				deltaDegrees
			);
			return [
				id,
				{
					...transform,
					x: state.center.x + rotatedOffset.x - canvasWidth / 2,
					y: state.center.y + rotatedOffset.y - canvasHeight / 2,
					rotation: normalizeRotation(transform.rotation + deltaDegrees)
				}
			];
		})
	);
}

export function groupScaleFactor(state: GroupTransformState, start: Point, current: Point): number {
	const startDistance = Math.hypot(start.x - state.center.x, start.y - state.center.y);
	if (startDistance === 0) return 1;
	return Math.hypot(current.x - state.center.x, current.y - state.center.y) / startDistance;
}

export function groupRotationDelta(
	state: GroupTransformState,
	start: Point,
	current: Point
): number {
	const startAngle = Math.atan2(start.y - state.center.y, start.x - state.center.x);
	const currentAngle = Math.atan2(current.y - state.center.y, current.x - state.center.x);
	return normalizeRotation(((currentAngle - startAngle) * 180) / Math.PI);
}

export function snapGroupTranslation({
	transforms,
	deltaX,
	deltaY,
	canvasWidth,
	canvasHeight,
	canvasScale = 1,
	currentSnapLines = [],
	otherItemBounds = []
}: {
	transforms: ReadonlyMap<string, GroupTransform>;
	deltaX: number;
	deltaY: number;
	canvasWidth: number;
	canvasHeight: number;
	canvasScale?: number;
	currentSnapLines?: readonly CanvasSnapLine[];
	otherItemBounds?: readonly GroupBounds[];
}): GroupTranslationSnapResult {
	const state = initializeGroupTransform(transforms, canvasWidth, canvasHeight);
	const moved = calculateGroupBounds(
		translateGroup(state, deltaX, deltaY),
		canvasWidth,
		canvasHeight
	);
	const virtual = {
		x: (moved.left + moved.right) / 2 - canvasWidth / 2,
		y: (moved.top + moved.bottom) / 2 - canvasHeight / 2,
		width: moved.width,
		height: moved.height,
		rotation: 0
	};
	const snapped = applyCanvasMoveSnapping({
		transform: virtual,
		canvasWidth,
		canvasHeight,
		canvasScale,
		currentSnapLines,
		otherItemBounds
	});
	return {
		deltaX: deltaX + snapped.transform.x - virtual.x,
		deltaY: deltaY + snapped.transform.y - virtual.y,
		snapLines: snapped.snapLines
	};
}

export function snapGroupScale({
	state,
	scale,
	canvasWidth,
	canvasHeight,
	canvasScale = 1,
	currentSnapLines = []
}: {
	state: GroupTransformState;
	scale: number;
	canvasWidth: number;
	canvasHeight: number;
	canvasScale?: number;
	currentSnapLines?: readonly CanvasSnapLine[];
}): GroupScaleSnapResult {
	const scaledBounds = calculateGroupBounds(
		scaleGroup(state, scale, canvasWidth, canvasHeight),
		canvasWidth,
		canvasHeight
	);
	const virtual = {
		x: state.center.x - canvasWidth / 2,
		y: state.center.y - canvasHeight / 2,
		width: scaledBounds.width,
		height: scaledBounds.height,
		rotation: 0
	};
	const snapped = applyCanvasResizeSnapping({
		transform: virtual,
		canvasWidth,
		canvasHeight,
		canvasScale,
		currentSnapLines,
		maintainAspectRatio: true
	});
	const widthScale = state.bounds.width > 0 ? snapped.transform.width / state.bounds.width : scale;
	const heightScale =
		state.bounds.height > 0 ? snapped.transform.height / state.bounds.height : scale;
	return {
		scale: Math.abs(widthScale - scale) <= Math.abs(heightScale - scale) ? widthScale : heightScale,
		snapLines: snapped.snapLines
	};
}

export function groupItemContainsPoint(
	transform: GroupTransform,
	point: Point,
	canvasWidth: number,
	canvasHeight: number
): boolean {
	const anchor = itemAnchor(transform, canvasWidth, canvasHeight);
	const rotated = rotate({ x: point.x - anchor.x, y: point.y - anchor.y }, -transform.rotation);
	const scaleX = transform.scaleX ?? 1;
	const scaleY = transform.scaleY ?? 1;
	if (Math.abs(scaleX) < Number.EPSILON || Math.abs(scaleY) < Number.EPSILON) return false;
	const local = { x: rotated.x / scaleX, y: rotated.y / scaleY };
	const anchorX = transform.anchorX ?? transform.width / 2;
	const anchorY = transform.anchorY ?? transform.height / 2;
	return (
		local.x >= -anchorX &&
		local.x <= transform.width - anchorX &&
		local.y >= -anchorY &&
		local.y <= transform.height - anchorY
	);
}

export function alignGroupItems(
	transforms: ReadonlyMap<string, GroupTransform>,
	alignment: GroupAlignment,
	canvasWidth: number,
	canvasHeight: number
): Map<string, GroupTransform> {
	const result = new Map(transforms);
	const entries = [...transforms].map(([id, transform]) => ({
		id,
		transform,
		bounds: groupItemBounds(transform, canvasWidth, canvasHeight)
	}));
	if (entries.length === 0) return result;

	if (alignment === 'distribute-horizontal' || alignment === 'distribute-vertical') {
		if (entries.length < 3) return result;
		const horizontal = alignment === 'distribute-horizontal';
		const sorted = [...entries].sort((left, right) =>
			horizontal ? left.bounds.left - right.bounds.left : left.bounds.top - right.bounds.top
		);
		const first = sorted[0]!;
		const last = sorted[sorted.length - 1]!;
		const spanStart = horizontal ? first.bounds.left : first.bounds.top;
		const spanEnd = horizontal ? last.bounds.right : last.bounds.bottom;
		const totalSize = sorted.reduce(
			(sum, entry) => sum + (horizontal ? entry.bounds.width : entry.bounds.height),
			0
		);
		const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1);
		let cursor = spanStart + (horizontal ? first.bounds.width : first.bounds.height);
		for (const entry of sorted.slice(1, -1)) {
			const currentStart = horizontal ? entry.bounds.left : entry.bounds.top;
			const targetStart = cursor + gap;
			const delta = targetStart - currentStart;
			result.set(entry.id, {
				...entry.transform,
				x: entry.transform.x + (horizontal ? delta : 0),
				y: entry.transform.y + (horizontal ? 0 : delta)
			});
			cursor = targetStart + (horizontal ? entry.bounds.width : entry.bounds.height);
		}
		return result;
	}

	for (const entry of entries) {
		let deltaX = 0;
		let deltaY = 0;
		switch (alignment) {
			case 'left':
				deltaX = -entry.bounds.left;
				break;
			case 'center-horizontal':
				deltaX = canvasWidth / 2 - (entry.bounds.left + entry.bounds.right) / 2;
				break;
			case 'right':
				deltaX = canvasWidth - entry.bounds.right;
				break;
			case 'top':
				deltaY = -entry.bounds.top;
				break;
			case 'center-vertical':
				deltaY = canvasHeight / 2 - (entry.bounds.top + entry.bounds.bottom) / 2;
				break;
			case 'bottom':
				deltaY = canvasHeight - entry.bounds.bottom;
				break;
		}
		result.set(entry.id, {
			...entry.transform,
			x: entry.transform.x + deltaX,
			y: entry.transform.y + deltaY
		});
	}
	return result;
}
