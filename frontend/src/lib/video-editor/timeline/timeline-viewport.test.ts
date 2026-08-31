import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	buildTimelineDensityBuckets,
	buildTimelineItemRangeIndex,
	buildTimelineTrackRenderPlan,
	findTimelineDensityBucketItem,
	queryTimelineItemRange,
	timelineCullRange,
	timelineNavigatorMetrics,
	timelineNavigatorPan,
	timelineNavigatorResize
} from './timeline-viewport';

function item(id: string, from: number, durationInFrames = 10): TimelineItem {
	return {
		id,
		trackId: 'track',
		from,
		durationInFrames,
		label: id,
		type: 'video'
	};
}

describe('timeline viewport planning', () => {
	it('finds long overlapping clips without scanning the offscreen prefix', () => {
		const index = buildTimelineItemRangeIndex([
			item('early', 0, 5),
			item('long', 10, 1000),
			...Array.from({ length: 200 }, (_, offset) => item(`short-${offset}`, 20 + offset * 5, 2))
		]);
		const visible = queryTimelineItemRange(index, { start: 500, end: 520 });
		expect(visible.map((candidate) => candidate.id)).toEqual([
			'long',
			'short-96',
			'short-97',
			'short-98',
			'short-99'
		]);
	});

	it('matches a full overlap scan for unsorted and deeply nested intervals', () => {
		const items = Array.from({ length: 4_000 }, (_, offset) =>
			item(
				`nested-${offset}`,
				(offset * 7_919) % 20_000,
				offset % 19 === 0 ? 30_000 - offset : (offset % 47) + 1
			)
		).toReversed();
		const index = buildTimelineItemRangeIndex(items);
		for (let offset = 0; offset < 20_000; offset += 137) {
			const range = { start: offset, end: offset + 83 };
			const expected = index.items
				.filter(
					(candidate) =>
						candidate.from < range.end && candidate.from + candidate.durationInFrames > range.start
				)
				.map((candidate) => candidate.id);
			expect(queryTimelineItemRange(index, range).map((candidate) => candidate.id)).toEqual(
				expected
			);
		}
	});

	it('uses a smaller stable overscan for dense tracks', () => {
		expect(
			timelineCullRange({
				scrollLeft: 4000,
				viewportWidth: 1000,
				headerWidth: 180,
				pixelsPerFrame: 4,
				trackItemCount: 79
			})
		).toEqual({ start: 500, end: 1705 });
		expect(
			timelineCullRange({
				scrollLeft: 4000,
				viewportWidth: 1000,
				headerWidth: 180,
				pixelsPerFrame: 4,
				trackItemCount: 80
			})
		).toEqual({ start: 850, end: 1355 });
	});

	it('compresses 30,000 compact clips to at most 1,024 buckets and promotes a bounded selection', () => {
		const index = buildTimelineItemRangeIndex(
			Array.from({ length: 30_000 }, (_, offset) => item(`clip-${offset}`, offset * 3, 2))
		);
		const selected = Array.from({ length: 500 }, (_, offset) => `clip-${offset}`);
		const plan = buildTimelineTrackRenderPlan({
			index,
			range: { start: 10_000, end: 10_100 },
			pixelsPerFrame: 0.1,
			selectedItemIds: selected,
			primarySelectedItemId: 'clip-499'
		});

		expect(plan.isDense).toBe(true);
		expect(buildTimelineDensityBuckets(index.items)).toHaveLength(1000);
		expect(plan.densityBuckets.length).toBeLessThan(25);
		expect(plan.nativeItems).toHaveLength(128);
		expect(plan.nativeItems.some((candidate) => candidate.id === 'clip-499')).toBe(true);
		expect(findTimelineDensityBucketItem(plan.densityBuckets[0]!, 89).id).toBe('clip-29');
	});

	it('keeps wide visible clips interactive on a dense track', () => {
		const index = buildTimelineItemRangeIndex(
			Array.from({ length: 80 }, (_, offset) => item(`wide-${offset}`, offset * 100, 60))
		);
		const plan = buildTimelineTrackRenderPlan({
			index,
			range: { start: 200, end: 450 },
			pixelsPerFrame: 1,
			selectedItemIds: []
		});
		expect(plan.nativeItems.map((candidate) => candidate.id)).toEqual([
			'wide-2',
			'wide-3',
			'wide-4'
		]);
	});

	it('caps rich roots when thousands of wide clips overlap the same viewport', () => {
		const index = buildTimelineItemRangeIndex(
			Array.from({ length: 10_000 }, (_, offset) => item(`overlap-${offset}`, offset % 10, 500))
		);
		const plan = buildTimelineTrackRenderPlan({
			index,
			range: { start: 0, end: 600 },
			pixelsPerFrame: 1,
			selectedItemIds: []
		});
		expect(plan.nativeItems).toHaveLength(256);
		expect(plan.densityBuckets.length).toBeLessThanOrEqual(1_024);
	});
});

describe('timeline navigator planning', () => {
	it('maps scroll to the thumb and clamps panning at both ends', () => {
		const metrics = timelineNavigatorMetrics({
			timelineWidth: 4000,
			viewportWidth: 1000,
			trackWidth: 400,
			scrollLeft: 1500
		});
		expect(metrics).toEqual({
			maxScrollLeft: 3000,
			thumbWidth: 100,
			thumbTravel: 300,
			thumbLeft: 150
		});
		expect(
			timelineNavigatorPan({ ...metrics, startThumbLeft: metrics.thumbLeft, deltaX: 500 })
		).toEqual({ thumbLeft: 300, scrollLeft: 3000 });
		expect(
			timelineNavigatorMetrics({
				timelineWidth: 10_000,
				viewportWidth: 320,
				trackWidth: 300,
				scrollLeft: 0,
				minThumbWidth: 88
			}).thumbWidth
		).toBe(88);
	});

	it('resizes around the held edge and returns a valid zoom and scroll pair', () => {
		const result = timelineNavigatorResize({
			handle: 'left',
			deltaX: -50,
			startThumbLeft: 150,
			startThumbWidth: 100,
			trackWidth: 400,
			viewportWidth: 1000,
			headerWidth: 180,
			contentFrames: 1000
		});
		expect(result.zoomLevel).toBeCloseTo(0.6217, 3);
		expect(result.thumbLeft + result.thumbWidth).toBeCloseTo(250, 5);
		expect(result.scrollLeft).toBeGreaterThan(0);
	});
});
