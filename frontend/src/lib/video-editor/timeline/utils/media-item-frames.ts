/**
 * Conversions between source-native seconds and timeline frames for a media
 * item, honoring the item's source window and speed. These power text-based
 * editing: transcript/silence/filler ranges are detected in source seconds and
 * must land on exact timeline split points.
 *
 * Ported from FreeCut (MIT) — utils/media-item-frames.ts — trimmed to the v1
 * surface (no composition wrappers; source fps comes from the item itself
 * because OpenPost has no media-library lookup inside this layer).
 */

import type { TimelineItem } from '../../project/types';
import { hasVariableSpeed, sourceFrameToTimelineOffset } from '../source-time-map';
import {
	getSourceProperties,
	sourceToTimelineFrames,
	timelineToSourceFrames
} from './source-calculations';

export function getMediaSourceFps(item: TimelineItem, timelineFps: number): number {
	if (item.type !== 'video' && item.type !== 'audio') return timelineFps;
	if (item.sourceFps !== undefined) return item.sourceFps;
	return timelineFps;
}

function getMediaSpeed(item: TimelineItem): number {
	return item.type === 'video' || item.type === 'audio' ? (item.speed ?? 1) : 1;
}

/** Map source seconds onto the continuous timeline position before boundary rounding. */
export function sourceSecondsToTimelinePosition(
	item: TimelineItem,
	sourceSeconds: number,
	timelineFps: number
): number {
	const sourceFps = getMediaSourceFps(item, timelineFps);
	const sourceFrame = sourceSeconds * sourceFps;
	if (hasVariableSpeed(item)) {
		return item.from + sourceFrameToTimelineOffset(item, sourceFrame, timelineFps);
	}
	const isMedia = item.type === 'video' || item.type === 'audio';
	const sourceStart = isMedia ? (item.sourceStart ?? 0) : 0;
	const sourceEnd = isMedia
		? (item.sourceEnd ??
			sourceStart +
				timelineToSourceFrames(item.durationInFrames, getMediaSpeed(item), timelineFps, sourceFps))
		: sourceStart;
	const deltaSourceFrames = item.isReversed ? sourceEnd - sourceFrame : sourceFrame - sourceStart;
	return item.from + (deltaSourceFrames / sourceFps / getMediaSpeed(item)) * timelineFps;
}

/**
 * Map a source-native time (seconds) onto the item's absolute timeline frame.
 * Returns the frame relative to `item.from` plus that offset — callers compare
 * against item bounds before splitting.
 */
export function sourceSecondsToTimelineFrame(
	item: TimelineItem,
	sourceSeconds: number,
	timelineFps: number
): number {
	const sourceFps = getMediaSourceFps(item, timelineFps);
	const sourceFrame = Math.round(sourceSeconds * sourceFps);
	if (hasVariableSpeed(item)) {
		return Math.round(item.from + sourceFrameToTimelineOffset(item, sourceFrame, timelineFps));
	}
	const isMedia = item.type === 'video' || item.type === 'audio';
	const sourceStart = isMedia ? (item.sourceStart ?? 0) : 0;
	const sourceEnd = isMedia
		? (item.sourceEnd ??
			sourceStart +
				timelineToSourceFrames(item.durationInFrames, getMediaSpeed(item), timelineFps, sourceFps))
		: sourceStart;
	const deltaSourceFrames = item.isReversed ? sourceEnd - sourceFrame : sourceFrame - sourceStart;
	const timelineDelta = sourceToTimelineFrames(
		deltaSourceFrames,
		getMediaSpeed(item),
		sourceFps,
		timelineFps
	);
	return Math.round(item.from + timelineDelta);
}

/** The item's visible source window in seconds, or null for non-media items. */
export function getItemSourceSpanSeconds(
	item: TimelineItem,
	timelineFps: number
): { start: number; end: number } | null {
	if (item.type !== 'video' && item.type !== 'audio') return null;
	const { sourceStart, speed } = getSourceProperties(item);
	const sourceFps = getMediaSourceFps(item, timelineFps);
	const sourceFrames = timelineToSourceFrames(item.durationInFrames, speed, timelineFps, sourceFps);
	const sourceEnd = item.sourceEnd ?? sourceStart + sourceFrames;
	return { start: sourceStart / sourceFps, end: sourceEnd / sourceFps };
}
