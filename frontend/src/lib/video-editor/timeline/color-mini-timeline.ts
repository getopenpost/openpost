import type { TimelineItem, TimelineMarker } from '$lib/video-editor/project/types';

const MIN_OVERVIEW_SECONDS = 10;

export function isColorTimelineItem(item: TimelineItem): boolean {
	return item.type !== 'audio' && item.type !== 'subtitle' && item.type !== 'controller';
}

export function resolveColorTimelineMaxFrame(options: {
	items: readonly Pick<TimelineItem, 'from' | 'durationInFrames'>[];
	markers?: readonly Pick<TimelineMarker, 'frame'>[];
	inPoint?: number | null;
	outPoint?: number | null;
	fps: number;
}): number {
	const itemEnd = options.items.reduce(
		(max, item) => Math.max(max, item.from + item.durationInFrames),
		0
	);
	const markerEnd = (options.markers ?? []).reduce((max, marker) => Math.max(max, marker.frame), 0);
	const minimum = Math.max(1, Math.round(Math.max(1, options.fps) * MIN_OVERVIEW_SECONDS));
	return Math.max(minimum, itemEnd, markerEnd, options.inPoint ?? 0, options.outPoint ?? 0);
}

export function colorTimelineFrameFromClientX(options: {
	clientX: number;
	left: number;
	width: number;
	labelWidth: number;
	maxFrame: number;
}): number | null {
	const contentWidth = options.width - options.labelWidth;
	if (!Number.isFinite(contentWidth) || contentWidth <= 0) return null;
	const ratio = Math.min(
		1,
		Math.max(0, (options.clientX - options.left - options.labelWidth) / contentWidth)
	);
	return Math.round(ratio * Math.max(1, options.maxFrame));
}

export function colorTimelineRatio(frame: number, maxFrame: number): number {
	return Math.min(1, Math.max(0, frame / Math.max(1, maxFrame)));
}

/** Resolve a clip's source-native start to the shared one-frame-per-second filmstrip index. */
export function colorClipStartFrameIndex(options: {
	sourceStart?: number;
	sourceDuration?: number;
	sourceFps?: number;
	mediaDuration?: number;
	mediaFps?: number;
}): number {
	const sourceStart = Math.max(0, options.sourceStart ?? 0);
	const sourceFps =
		options.sourceFps && options.sourceFps > 0
			? options.sourceFps
			: options.mediaFps && options.mediaFps > 0
				? options.mediaFps
				: 30;
	const startSeconds =
		options.mediaDuration &&
		options.mediaDuration > 0 &&
		options.sourceDuration &&
		options.sourceDuration > 0
			? (sourceStart / options.sourceDuration) * options.mediaDuration
			: sourceStart / sourceFps;
	return Math.max(0, Math.floor(startSeconds));
}
