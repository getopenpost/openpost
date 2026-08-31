import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { isColorTimelineItem } from './color-mini-timeline';

// Match FreeCut's Color-page target order: grade source footage before overlays
// that happen to share the same frame.
const GRADE_TYPE_PRIORITY = {
	video: 0,
	image: 1,
	lottie: 1,
	background: 1,
	composition: 2,
	adjustment: 3,
	shape: 4,
	text: 5,
	subtitle: 6,
	controller: Number.POSITIVE_INFINITY,
	audio: Number.POSITIVE_INFINITY
} satisfies Record<TimelineItem['type'], number>;

export function colorItemSpansFrame(item: TimelineItem, frame: number): boolean {
	return frame >= item.from && frame < item.from + item.durationInFrames;
}

export function colorSelectionSpansFrame(
	selectedItemIds: readonly string[],
	itemById: ReadonlyMap<string, TimelineItem>,
	frame: number
): boolean {
	return selectedItemIds.some((id) => {
		const item = itemById.get(id);
		return Boolean(item && isColorTimelineItem(item) && colorItemSpansFrame(item, frame));
	});
}

export function colorGradeTargetAtFrame(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[],
	frame: number
): TimelineItem | null {
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	let target: TimelineItem | null = null;
	let targetPriority = Number.POSITIVE_INFINITY;
	let targetTrackOrder = Number.POSITIVE_INFINITY;

	for (const item of items) {
		if (!isColorTimelineItem(item) || !colorItemSpansFrame(item, frame)) continue;
		const track = trackById.get(item.trackId);
		if (!track || track.isGroup || track.visible === false) continue;
		const priority = GRADE_TYPE_PRIORITY[item.type];
		if (
			priority < targetPriority ||
			(priority === targetPriority && track.order < targetTrackOrder)
		) {
			target = item;
			targetPriority = priority;
			targetTrackOrder = track.order;
		}
	}

	return target;
}
