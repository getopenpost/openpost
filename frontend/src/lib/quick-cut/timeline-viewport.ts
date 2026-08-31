export interface TimelineViewport {
	start: number;
	zoom: number;
}

export const MIN_TIMELINE_ZOOM = 1;
export const MAX_TIMELINE_ZOOM = 32;

export function visibleTimelineDuration(duration: number, zoom: number): number {
	return duration > 0 ? duration / Math.max(MIN_TIMELINE_ZOOM, zoom) : 0;
}

export function clampTimelineViewport(
	viewport: TimelineViewport,
	duration: number
): TimelineViewport {
	const zoom = Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, viewport.zoom));
	const visible = visibleTimelineDuration(duration, zoom);
	return {
		zoom,
		start: Math.max(0, Math.min(Math.max(0, duration - visible), viewport.start))
	};
}

export function timelineTimeAtFraction(
	viewport: TimelineViewport,
	duration: number,
	fraction: number
): number {
	const visible = visibleTimelineDuration(duration, viewport.zoom);
	return Math.max(
		0,
		Math.min(duration, viewport.start + Math.max(0, Math.min(1, fraction)) * visible)
	);
}

export function zoomTimelineViewport(
	viewport: TimelineViewport,
	duration: number,
	nextZoom: number,
	anchorFraction: number
): TimelineViewport {
	const anchor = timelineTimeAtFraction(viewport, duration, anchorFraction);
	const clampedZoom = Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, nextZoom));
	const nextVisible = visibleTimelineDuration(duration, clampedZoom);
	return clampTimelineViewport(
		{ start: anchor - Math.max(0, Math.min(1, anchorFraction)) * nextVisible, zoom: clampedZoom },
		duration
	);
}

export function panTimelineViewport(
	viewport: TimelineViewport,
	duration: number,
	deltaPixels: number,
	widthPixels: number
): TimelineViewport {
	if (widthPixels <= 0) return clampTimelineViewport(viewport, duration);
	const visible = visibleTimelineDuration(duration, viewport.zoom);
	return clampTimelineViewport(
		{ ...viewport, start: viewport.start + (deltaPixels / widthPixels) * visible },
		duration
	);
}

export function revealTimelineTime(
	viewport: TimelineViewport,
	duration: number,
	time: number
): TimelineViewport {
	const current = clampTimelineViewport(viewport, duration);
	const visible = visibleTimelineDuration(duration, current.zoom);
	if (time >= current.start && time <= current.start + visible) return current;
	const leadingMargin = visible * 0.1;
	const start = time < current.start ? time - leadingMargin : time - visible + leadingMargin;
	return clampTimelineViewport({ ...current, start }, duration);
}
