import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	groupItemContainsPoint,
	type GroupTransform,
	type Point
} from '$lib/video-editor/preview/group-transform';

export interface CanvasLayerCandidate {
	item: TimelineItem;
	trackName: string;
	transform: GroupTransform;
}

export interface ClientRectBounds {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function canvasPointFromClient(
	clientX: number,
	clientY: number,
	rect: ClientRectBounds,
	canvasWidth: number,
	canvasHeight: number
): Point | null {
	if (rect.width <= 0 || rect.height <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return null;
	return {
		x: ((clientX - rect.left) / rect.width) * canvasWidth,
		y: ((clientY - rect.top) / rect.height) * canvasHeight
	};
}

/** Candidates arrive bottom-first from paintOrder and are returned top-first for the menu. */
export function canvasLayersAtPoint(
	candidates: readonly CanvasLayerCandidate[],
	point: Point,
	canvasWidth: number,
	canvasHeight: number
): CanvasLayerCandidate[] {
	return candidates
		.filter((candidate) =>
			groupItemContainsPoint(candidate.transform, point, canvasWidth, canvasHeight)
		)
		.toReversed();
}
