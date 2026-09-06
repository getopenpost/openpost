/** Canvas move and resize snapping. Ported from FreeCut (MIT). */
import type { ItemTransform } from '$lib/video-editor/project/types';

export type SnapTransform = Required<
	Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>
> &
	ItemTransform;

export interface CanvasBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface CanvasSnapLine {
	type: 'horizontal' | 'vertical';
	position: number;
	label?: CanvasSnapLabel;
}

export type CanvasSnapLabel = 'edge' | 'align' | 'center' | `${number}%`;

export interface CanvasSnapResult {
	transform: SnapTransform;
	snapLines: CanvasSnapLine[];
}

interface SnapPoint {
	pos: number;
	label?: CanvasSnapLabel;
}

const SNAP_ENTER_SCREEN_PX = 8;
const SNAP_EXIT_SCREEN_PX = 18;

function thresholds(canvasScale: number) {
	const scale = canvasScale > 0 ? canvasScale : 1;
	return { enter: SNAP_ENTER_SCREEN_PX / scale, exit: SNAP_EXIT_SCREEN_PX / scale };
}

function bestMatch(
	snapPoints: readonly SnapPoint[],
	edges: readonly number[],
	heldPositions: ReadonlySet<number>,
	enterThreshold: number,
	exitThreshold: number
): { snapPoint: SnapPoint; edge: number; distance: number } | null {
	let best: { snapPoint: SnapPoint; edge: number; distance: number } | null = null;
	for (const snapPoint of snapPoints) {
		const threshold = heldPositions.has(snapPoint.pos) ? exitThreshold : enterThreshold;
		for (const edge of edges) {
			const distance = Math.abs(edge - snapPoint.pos);
			if (distance >= threshold || (best && distance >= best.distance)) continue;
			best = { snapPoint, edge, distance };
		}
	}
	return best;
}

function moveSnapPoints(canvasWidth: number, canvasHeight: number) {
	return {
		vertical: [
			{ pos: 0, label: 'edge' },
			{ pos: canvasWidth / 2, label: '50%' },
			{ pos: canvasWidth, label: 'edge' }
		],
		horizontal: [
			{ pos: 0, label: 'edge' },
			{ pos: canvasHeight / 2, label: '50%' },
			{ pos: canvasHeight, label: 'edge' }
		]
	};
}

function resizeSnapPoints(canvasWidth: number, canvasHeight: number) {
	return {
		vertical: [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
			pos: canvasWidth * ratio,
			label: percentLabel(ratio)
		})),
		horizontal: [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
			pos: canvasHeight * ratio,
			label: percentLabel(ratio)
		}))
	};
}

function percentLabel(ratio: number): `${number}%` {
	return `${ratio * 100}%`;
}

function neighboringSnapPoints(bounds: readonly CanvasBounds[]) {
	const vertical = new Map<number, CanvasSnapLabel>();
	const horizontal = new Map<number, CanvasSnapLabel>();
	for (const bound of bounds) {
		vertical.set(bound.left, 'align');
		vertical.set((bound.left + bound.right) / 2, 'center');
		vertical.set(bound.right, 'align');
		horizontal.set(bound.top, 'align');
		horizontal.set((bound.top + bound.bottom) / 2, 'center');
		horizontal.set(bound.bottom, 'align');
	}
	return {
		vertical: [...vertical].map(([pos, label]) => ({ pos, label })),
		horizontal: [...horizontal].map(([pos, label]) => ({ pos, label }))
	};
}

export function computeCanvasItemBounds(
	transform: SnapTransform,
	canvasWidth: number,
	canvasHeight: number,
	strokeExpansion = 0
): CanvasBounds {
	const anchorWorldX = canvasWidth / 2 + transform.x;
	const anchorWorldY = canvasHeight / 2 + transform.y;
	const halfWidth = transform.width / 2 + strokeExpansion / 2;
	const halfHeight = transform.height / 2 + strokeExpansion / 2;
	const anchorX = transform.anchorX ?? transform.width / 2;
	const anchorY = transform.anchorY ?? transform.height / 2;
	const radians = (transform.rotation * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	if (anchorX === transform.width / 2 && anchorY === transform.height / 2) {
		const extentX = Math.abs(halfWidth * cosine) + Math.abs(halfHeight * sine);
		const extentY = Math.abs(halfWidth * sine) + Math.abs(halfHeight * cosine);
		return bounds(
			anchorWorldX - extentX,
			anchorWorldY - extentY,
			anchorWorldX + extentX,
			anchorWorldY + extentY
		);
	}

	const corners: Array<readonly [number, number]> = [
		[-anchorX - strokeExpansion / 2, -anchorY - strokeExpansion / 2],
		[transform.width - anchorX + strokeExpansion / 2, -anchorY - strokeExpansion / 2],
		[
			transform.width - anchorX + strokeExpansion / 2,
			transform.height - anchorY + strokeExpansion / 2
		],
		[-anchorX - strokeExpansion / 2, transform.height - anchorY + strokeExpansion / 2]
	];
	let left = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const [cornerX, cornerY] of corners) {
		const rotatedX = anchorWorldX + cornerX * cosine - cornerY * sine;
		const rotatedY = anchorWorldY + cornerX * sine + cornerY * cosine;
		left = Math.min(left, rotatedX);
		right = Math.max(right, rotatedX);
		top = Math.min(top, rotatedY);
		bottom = Math.max(bottom, rotatedY);
	}
	return bounds(left, top, right, bottom);
}

function bounds(left: number, top: number, right: number, bottom: number): CanvasBounds {
	return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function applyCanvasMoveSnapping({
	transform,
	canvasWidth,
	canvasHeight,
	currentSnapLines = [],
	strokeExpansion = 0,
	canvasScale = 1,
	otherItemBounds = []
}: {
	transform: SnapTransform;
	canvasWidth: number;
	canvasHeight: number;
	currentSnapLines?: readonly CanvasSnapLine[];
	strokeExpansion?: number;
	canvasScale?: number;
	otherItemBounds?: readonly CanvasBounds[];
}): CanvasSnapResult {
	const canvasPoints = moveSnapPoints(canvasWidth, canvasHeight);
	const itemPoints = neighboringSnapPoints(otherItemBounds);
	const vertical = [...canvasPoints.vertical, ...itemPoints.vertical];
	const horizontal = [...canvasPoints.horizontal, ...itemPoints.horizontal];
	const itemBounds = computeCanvasItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
	const { enter, exit } = thresholds(canvasScale);
	const heldVertical = currentSnapLines.find((line) => line.type === 'vertical');
	const heldHorizontal = currentSnapLines.find((line) => line.type === 'horizontal');
	const verticalMatch = bestMatch(
		vertical,
		[itemBounds.left, (itemBounds.left + itemBounds.right) / 2, itemBounds.right],
		new Set(heldVertical ? [heldVertical.position] : []),
		enter,
		exit
	);
	const horizontalMatch = bestMatch(
		horizontal,
		[itemBounds.top, (itemBounds.top + itemBounds.bottom) / 2, itemBounds.bottom],
		new Set(heldHorizontal ? [heldHorizontal.position] : []),
		enter,
		exit
	);
	const snapLines: CanvasSnapLine[] = [];
	if (verticalMatch) {
		snapLines.push({
			type: 'vertical',
			position: verticalMatch.snapPoint.pos,
			label: verticalMatch.snapPoint.label
		});
	}
	if (horizontalMatch) {
		snapLines.push({
			type: 'horizontal',
			position: horizontalMatch.snapPoint.pos,
			label: horizontalMatch.snapPoint.label
		});
	}
	return {
		transform: {
			...transform,
			x: verticalMatch
				? Math.round(transform.x + verticalMatch.snapPoint.pos - verticalMatch.edge)
				: transform.x,
			y: horizontalMatch
				? Math.round(transform.y + horizontalMatch.snapPoint.pos - horizontalMatch.edge)
				: transform.y
		},
		snapLines
	};
}

export function applyCanvasResizeSnapping({
	transform,
	canvasWidth,
	canvasHeight,
	currentSnapLines = [],
	strokeExpansion = 0,
	canvasScale = 1,
	maintainAspectRatio = true
}: {
	transform: SnapTransform;
	canvasWidth: number;
	canvasHeight: number;
	currentSnapLines?: readonly CanvasSnapLine[];
	strokeExpansion?: number;
	canvasScale?: number;
	maintainAspectRatio?: boolean;
}): CanvasSnapResult {
	const snapPoints = resizeSnapPoints(canvasWidth, canvasHeight);
	const itemBounds = computeCanvasItemBounds(transform, canvasWidth, canvasHeight, strokeExpansion);
	const { enter, exit } = thresholds(canvasScale);
	const widthMatch = bestMatch(
		snapPoints.vertical,
		[itemBounds.left, itemBounds.right],
		new Set(
			currentSnapLines.filter((line) => line.type === 'vertical').map((line) => line.position)
		),
		enter,
		exit
	);
	const heightMatch = bestMatch(
		snapPoints.horizontal,
		[itemBounds.top, itemBounds.bottom],
		new Set(
			currentSnapLines.filter((line) => line.type === 'horizontal').map((line) => line.position)
		),
		enter,
		exit
	);
	if (!widthMatch && !heightMatch) {
		return {
			transform,
			snapLines: []
		};
	}

	const centerX = (itemBounds.left + itemBounds.right) / 2;
	const centerY = (itemBounds.top + itemBounds.bottom) / 2;
	const widthCandidate = widthMatch
		? {
				distance: widthMatch.distance,
				value:
					widthMatch.edge === itemBounds.left
						? (centerX - widthMatch.snapPoint.pos) * 2
						: (widthMatch.snapPoint.pos - centerX) * 2
			}
		: null;
	const heightCandidate = heightMatch
		? {
				distance: heightMatch.distance,
				value:
					heightMatch.edge === itemBounds.top
						? (centerY - heightMatch.snapPoint.pos) * 2
						: (heightMatch.snapPoint.pos - centerY) * 2
			}
		: null;
	const aspectRatio = transform.width / Math.max(0.0001, transform.height);
	let width = transform.width;
	let height = transform.height;
	if (maintainAspectRatio) {
		if (
			widthCandidate &&
			(!heightCandidate || widthCandidate.distance <= heightCandidate.distance)
		) {
			const scale = widthCandidate.value / Math.max(0.0001, itemBounds.width);
			width = transform.width * scale;
			height = width / aspectRatio;
		} else if (heightCandidate) {
			const scale = heightCandidate.value / Math.max(0.0001, itemBounds.height);
			height = transform.height * scale;
			width = height * aspectRatio;
		}
	} else {
		const free = freeResizeDimensions(
			transform,
			widthCandidate?.value,
			heightCandidate?.value,
			strokeExpansion,
			widthCandidate?.distance ?? Number.POSITIVE_INFINITY,
			heightCandidate?.distance ?? Number.POSITIVE_INFINITY
		);
		width = free.width;
		height = free.height;
	}

	let x = transform.x;
	let y = transform.y;
	if (Math.abs(width - canvasWidth) < 15) {
		width = canvasWidth;
		if (maintainAspectRatio) height = width / aspectRatio;
		x = 0;
	}
	if (Math.abs(height - canvasHeight) < 15) {
		height = canvasHeight;
		if (maintainAspectRatio) width = height * aspectRatio;
		y = 0;
	}
	let next = roundedTransform({
		...transform,
		x,
		y,
		width: Math.max(20, width),
		height: Math.max(20, height)
	});
	let finalBounds = computeCanvasItemBounds(next, canvasWidth, canvasHeight, strokeExpansion);
	if (widthMatch) {
		const finalEdge = widthMatch.edge === itemBounds.left ? finalBounds.left : finalBounds.right;
		next = { ...next, x: next.x + widthMatch.snapPoint.pos - finalEdge };
	}
	if (heightMatch) {
		const finalEdge = heightMatch.edge === itemBounds.top ? finalBounds.top : finalBounds.bottom;
		next = { ...next, y: next.y + heightMatch.snapPoint.pos - finalEdge };
	}
	next = roundedTransform(next);
	finalBounds = computeCanvasItemBounds(next, canvasWidth, canvasHeight, strokeExpansion);
	const snapLines: CanvasSnapLine[] = [];
	for (const snapPoint of snapPoints.vertical) {
		if (
			Math.abs(finalBounds.left - snapPoint.pos) < 3 ||
			Math.abs(finalBounds.right - snapPoint.pos) < 3
		) {
			snapLines.push({ type: 'vertical', position: snapPoint.pos, label: snapPoint.label });
		}
	}
	for (const snapPoint of snapPoints.horizontal) {
		if (
			Math.abs(finalBounds.top - snapPoint.pos) < 3 ||
			Math.abs(finalBounds.bottom - snapPoint.pos) < 3
		) {
			snapLines.push({ type: 'horizontal', position: snapPoint.pos, label: snapPoint.label });
		}
	}
	return { transform: next, snapLines };
}

function freeResizeDimensions(
	transform: SnapTransform,
	targetBoundsWidth: number | undefined,
	targetBoundsHeight: number | undefined,
	strokeExpansion: number,
	widthDistance: number,
	heightDistance: number
) {
	const radians = (transform.rotation * Math.PI) / 180;
	const cosine = Math.abs(Math.cos(radians));
	const sine = Math.abs(Math.sin(radians));
	const strokeExtent = strokeExpansion * (cosine + sine);
	let targetWidth = targetBoundsWidth === undefined ? undefined : targetBoundsWidth - strokeExtent;
	let targetHeight =
		targetBoundsHeight === undefined ? undefined : targetBoundsHeight - strokeExtent;
	const determinant = cosine * cosine - sine * sine;
	if (targetWidth !== undefined && targetHeight !== undefined && Math.abs(determinant) > 0.001) {
		return {
			width: Math.max(20, (cosine * targetWidth - sine * targetHeight) / determinant),
			height: Math.max(20, (cosine * targetHeight - sine * targetWidth) / determinant)
		};
	}
	if (targetWidth !== undefined && targetHeight !== undefined) {
		if (widthDistance <= heightDistance) targetHeight = undefined;
		else targetWidth = undefined;
	}
	let width = transform.width;
	let height = transform.height;
	if (targetWidth !== undefined) {
		if (cosine >= sine && cosine > 0.0001) {
			width = Math.max(20, (targetWidth - sine * height) / cosine);
		} else if (sine > 0.0001) {
			height = Math.max(20, (targetWidth - cosine * width) / sine);
		}
	}
	if (targetHeight !== undefined) {
		if (cosine >= sine && cosine > 0.0001) {
			height = Math.max(20, (targetHeight - sine * width) / cosine);
		} else if (sine > 0.0001) {
			width = Math.max(20, (targetHeight - cosine * height) / sine);
		}
	}
	return { width, height };
}

function roundedTransform(transform: SnapTransform): SnapTransform {
	return {
		...transform,
		x: Math.round(transform.x),
		y: Math.round(transform.y),
		width: Math.round(transform.width),
		height: Math.round(transform.height)
	};
}
