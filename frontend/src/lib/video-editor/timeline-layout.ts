export interface TimelineInterval {
	id: string;
	start_us: number;
	duration_us: number;
}

export interface TimelineIntervalPlacement {
	id: string;
	lane: number;
	left_px: number;
	width_px: number;
}

export interface TimelineIntervalLayout {
	lane_count: number;
	placements: Map<string, TimelineIntervalPlacement>;
}

export function fitTimelineItemDuration(
	sourceDurationUS: number,
	projectDurationUS: number,
	timelineStartUS: number
): { duration_us: number; trimmed: boolean } {
	const sourceDuration = Math.max(0, sourceDurationUS);
	const availableDuration = Math.max(0, projectDurationUS - timelineStartUS);
	const duration =
		availableDuration > 0 ? Math.min(sourceDuration, availableDuration) : sourceDuration;
	return { duration_us: duration, trimmed: duration < sourceDuration };
}

/**
 * Assigns timeline items to the first free visual lane. The calculation uses
 * their rendered pixel width, including the minimum hit target, so adjacent
 * short items never paint or receive pointer input on top of each other.
 */
export function layoutTimelineIntervals(
	items: TimelineInterval[],
	durationUS: number,
	widthPX: number,
	minimumWidthPX: number
): TimelineIntervalLayout {
	const safeDuration = Math.max(1, durationUS);
	const safeWidth = Math.max(1, widthPX);
	const laneEnds: number[] = [];
	const placements = new Map<string, TimelineIntervalPlacement>();
	const sorted = items
		.map((item, index) => {
			const leftPX = (Math.max(0, item.start_us) / safeDuration) * safeWidth;
			const width = Math.max(
				minimumWidthPX,
				(Math.max(0, item.duration_us) / safeDuration) * safeWidth
			);
			return {
				item,
				index,
				leftPX,
				widthPX: Math.min(width, Math.max(minimumWidthPX, safeWidth - leftPX))
			};
		})
		.sort((left, right) => left.leftPX - right.leftPX || left.index - right.index);

	for (const entry of sorted) {
		let lane = laneEnds.findIndex((endPX) => endPX <= entry.leftPX);
		if (lane < 0) {
			lane = laneEnds.length;
			laneEnds.push(0);
		}
		laneEnds[lane] = entry.leftPX + entry.widthPX;
		placements.set(entry.item.id, {
			id: entry.item.id,
			lane,
			left_px: entry.leftPX,
			width_px: entry.widthPX
		});
	}

	return { lane_count: Math.max(1, laneEnds.length), placements };
}
