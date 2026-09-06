export const TIMELINE_ZOOM_MIN = 0.01;
export const TIMELINE_ZOOM_MAX = 2;
export const TIMELINE_ZOOM_STEP = 1.15;
export const TIMELINE_PIXELS_PER_FRAME_AT_100 = 4;
export const TIMELINE_FIT_RIGHT_PADDING = 50;

export interface TimelineZoomAnchor {
	frame: number;
	screenX: number;
}

export function clampTimelineZoom(level: number): number {
	if (!Number.isFinite(level)) return 1;
	return Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, level));
}

export function timelinePixelsPerFrame(level: number): number {
	return TIMELINE_PIXELS_PER_FRAME_AT_100 * clampTimelineZoom(level);
}

export function timelineZoomToSlider(level: number): number {
	return (
		Math.log(clampTimelineZoom(level) / TIMELINE_ZOOM_MIN) /
		Math.log(TIMELINE_ZOOM_MAX / TIMELINE_ZOOM_MIN)
	);
}

export function timelineSliderToZoom(value: number): number {
	const position = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
	return clampTimelineZoom(
		TIMELINE_ZOOM_MIN * Math.pow(TIMELINE_ZOOM_MAX / TIMELINE_ZOOM_MIN, position)
	);
}

export function timelineZoomToFit(params: {
	viewportWidth: number;
	headerWidth: number;
	durationInFrames: number;
	fps: number;
	rightPadding?: number;
}): number {
	const fps = params.fps > 0 ? params.fps : 1;
	const durationInFrames = Math.max(fps * 10, params.durationInFrames);
	const availableWidth = Math.max(
		0,
		params.viewportWidth - params.headerWidth - (params.rightPadding ?? TIMELINE_FIT_RIGHT_PADDING)
	);
	return clampTimelineZoom(availableWidth / (durationInFrames * TIMELINE_PIXELS_PER_FRAME_AT_100));
}

export function cursorZoomAnchor(params: {
	zoomLevel: number;
	pointerScreenX: number;
	scrollLeft: number;
	headerWidth: number;
	maxFrame: number;
}): TimelineZoomAnchor {
	const frame =
		(params.scrollLeft + params.pointerScreenX - params.headerWidth) /
		timelinePixelsPerFrame(params.zoomLevel);
	return {
		frame: Math.min(Math.max(0, params.maxFrame), Math.max(0, frame)),
		screenX: params.pointerScreenX
	};
}

export function playheadZoomAnchor(params: {
	frame: number;
	zoomLevel: number;
	scrollLeft: number;
	headerWidth: number;
	maxFrame: number;
}): TimelineZoomAnchor {
	const frame = Math.min(Math.max(0, params.maxFrame), Math.max(0, params.frame));
	return {
		frame,
		screenX:
			params.headerWidth + frame * timelinePixelsPerFrame(params.zoomLevel) - params.scrollLeft
	};
}

export function anchoredTimelineScrollLeft(params: {
	anchor: TimelineZoomAnchor;
	nextZoomLevel: number;
	headerWidth: number;
}): number {
	return Math.max(
		0,
		params.headerWidth +
			params.anchor.frame * timelinePixelsPerFrame(params.nextZoomLevel) -
			params.anchor.screenX
	);
}

export function centeredTimelineScrollLeft(params: {
	frame: number;
	zoomLevel: number;
	viewportWidth: number;
	headerWidth: number;
}): number {
	const timeViewportWidth = Math.max(0, params.viewportWidth - params.headerWidth);
	return Math.max(
		0,
		params.frame * timelinePixelsPerFrame(params.zoomLevel) - timeViewportWidth / 2
	);
}
