import type { TimelineItem } from '../project/types';
import {
	TIMELINE_PIXELS_PER_FRAME_AT_100,
	clampTimelineZoom,
	timelinePixelsPerFrame
} from './zoom';

export const DENSE_TIMELINE_TRACK_ITEM_THRESHOLD = 80;
export const DENSE_TIMELINE_MAX_BUCKETS = 1024;
export const DEFAULT_TIMELINE_CULL_BUFFER_PX = 2000;
export const DENSE_TIMELINE_CULL_BUFFER_PX = 600;
export const COMPACT_TIMELINE_ITEM_MAX_WIDTH_PX = 36;
export const MAX_PROMOTED_DENSE_ITEMS = 128;
export const MAX_DENSE_NATIVE_ITEMS = 256;
export const TIMELINE_NAVIGATOR_MIN_THUMB_PX = 40;

export interface TimelineFrameRange {
	start: number;
	end: number;
}

export interface TimelineItemRangeIndex {
	items: TimelineItem[];
	root: TimelineItemRangeNode | null;
	itemById: Map<string, TimelineItem>;
	orderById: Map<string, number>;
}

interface TimelineItemRangeNode {
	item: TimelineItem;
	from: number;
	end: number;
	minStart: number;
	maxEnd: number;
	left: TimelineItemRangeNode | null;
	right: TimelineItemRangeNode | null;
}

export interface TimelineDensityBucket {
	index: number;
	from: number;
	durationInFrames: number;
	items: readonly TimelineItem[];
}

export interface TimelineTrackRenderPlan {
	nativeItems: TimelineItem[];
	densityBuckets: readonly TimelineDensityBucket[];
	isDense: boolean;
	range: TimelineFrameRange;
}

function orderIndexedItems(
	itemsById: ReadonlyMap<string, TimelineItem>,
	index: TimelineItemRangeIndex
): TimelineItem[] {
	return [...itemsById.values()].sort(
		(left, right) => (index.orderById.get(left.id) ?? 0) - (index.orderById.get(right.id) ?? 0)
	);
}

export function buildTimelineItemRangeIndex(
	items: readonly TimelineItem[]
): TimelineItemRangeIndex {
	let ordered = [...items];
	for (let itemIndex = 1; itemIndex < ordered.length; itemIndex++) {
		if (ordered[itemIndex]!.from >= ordered[itemIndex - 1]!.from) continue;
		ordered = ordered.sort(
			(left, right) => left.from - right.from || left.durationInFrames - right.durationInFrames
		);
		break;
	}
	const itemById = new Map<string, TimelineItem>();
	const orderById = new Map<string, number>();
	for (const [index, item] of ordered.entries()) {
		itemById.set(item.id, item);
		orderById.set(item.id, index);
	}

	function build(start: number, end: number): TimelineItemRangeNode | null {
		if (start >= end) return null;
		const middle = (start + end) >>> 1;
		const item = ordered[middle]!;
		const left = build(start, middle);
		const right = build(middle + 1, end);
		const itemEnd = item.from + item.durationInFrames;
		return {
			item,
			from: item.from,
			end: itemEnd,
			minStart: Math.min(item.from, left?.minStart ?? item.from, right?.minStart ?? item.from),
			maxEnd: Math.max(itemEnd, left?.maxEnd ?? itemEnd, right?.maxEnd ?? itemEnd),
			left,
			right
		};
	}

	return { items: ordered, root: build(0, ordered.length), itemById, orderById };
}

/** Pruned interval query that preserves timeline order and finds long clips starting offscreen. */
export function queryTimelineItemRange(
	index: TimelineItemRangeIndex,
	range: TimelineFrameRange
): TimelineItem[] {
	const visible: TimelineItem[] = [];
	function visit(node: TimelineItemRangeNode | null): void {
		if (!node || node.maxEnd <= range.start || node.minStart >= range.end) return;
		visit(node.left);
		if (node.from < range.end && node.end > range.start) visible.push(node.item);
		visit(node.right);
	}
	visit(index.root);
	return visible;
}

export function timelineCullRange(args: {
	scrollLeft: number;
	viewportWidth: number;
	headerWidth: number;
	pixelsPerFrame: number;
	trackItemCount: number;
}): TimelineFrameRange {
	const buffer =
		args.trackItemCount >= DENSE_TIMELINE_TRACK_ITEM_THRESHOLD
			? DENSE_TIMELINE_CULL_BUFFER_PX
			: DEFAULT_TIMELINE_CULL_BUFFER_PX;
	const pixelsPerFrame = Math.max(0.001, args.pixelsPerFrame);
	return {
		start: Math.max(0, (args.scrollLeft - buffer) / pixelsPerFrame),
		end: Math.max(
			0,
			(args.scrollLeft + args.viewportWidth - args.headerWidth + buffer) / pixelsPerFrame
		)
	};
}

export function buildTimelineDensityBuckets(
	items: readonly TimelineItem[],
	maxBucketCount = DENSE_TIMELINE_MAX_BUCKETS
): TimelineDensityBucket[] {
	if (items.length === 0 || maxBucketCount <= 0) return [];
	const ordered = [...items].sort((left, right) => left.from - right.from);
	const bucketSize = Math.max(1, Math.ceil(ordered.length / maxBucketCount));
	const buckets: TimelineDensityBucket[] = [];
	for (let start = 0; start < ordered.length; start += bucketSize) {
		const bucketItems = ordered.slice(start, start + bucketSize);
		let from = Number.POSITIVE_INFINITY;
		let end = Number.NEGATIVE_INFINITY;
		for (const item of bucketItems) {
			from = Math.min(from, item.from);
			end = Math.max(end, item.from + item.durationInFrames);
		}
		buckets.push({
			index: buckets.length,
			from,
			durationInFrames: Math.max(1, end - from),
			items: bucketItems
		});
	}
	return buckets;
}

export function findTimelineDensityBucketItem(
	bucket: TimelineDensityBucket,
	frame: number
): TimelineItem {
	let closest = bucket.items[0]!;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const item of bucket.items) {
		if (frame >= item.from && frame < item.from + item.durationInFrames) return item;
		const distance = Math.abs(item.from + item.durationInFrames / 2 - frame);
		if (distance < closestDistance) {
			closest = item;
			closestDistance = distance;
		}
	}
	return closest;
}

export function buildTimelineTrackRenderPlan(args: {
	index: TimelineItemRangeIndex;
	range: TimelineFrameRange;
	pixelsPerFrame: number;
	selectedItemIds: readonly string[];
	primarySelectedItemId?: string | null;
	densityBuckets?: readonly TimelineDensityBucket[];
}): TimelineTrackRenderPlan {
	const isDense = args.index.items.length >= DENSE_TIMELINE_TRACK_ITEM_THRESHOLD;
	const visibleItems = queryTimelineItemRange(args.index, args.range);
	if (!isDense) {
		const nativeById = new Map(visibleItems.map((item) => [item.id, item]));
		for (const id of args.selectedItemIds.slice(0, MAX_PROMOTED_DENSE_ITEMS)) {
			const item = args.index.itemById.get(id);
			if (item) nativeById.set(id, item);
		}
		return {
			nativeItems: orderIndexedItems(nativeById, args.index),
			densityBuckets: [],
			isDense,
			range: args.range
		};
	}

	const promotedIds = new Set<string>();
	if (args.primarySelectedItemId && args.index.itemById.has(args.primarySelectedItemId)) {
		promotedIds.add(args.primarySelectedItemId);
	}
	for (const id of args.selectedItemIds) {
		if (promotedIds.size >= MAX_PROMOTED_DENSE_ITEMS) break;
		if (args.index.itemById.has(id)) promotedIds.add(id);
	}
	const nativeById = new Map<string, TimelineItem>();
	for (const id of promotedIds) nativeById.set(id, args.index.itemById.get(id)!);
	const rangeCenter = (args.range.start + args.range.end) / 2;
	const wideVisibleItems = visibleItems
		.filter(
			(item) => item.durationInFrames * args.pixelsPerFrame > COMPACT_TIMELINE_ITEM_MAX_WIDTH_PX
		)
		.sort(
			(left, right) =>
				Math.abs(left.from + left.durationInFrames / 2 - rangeCenter) -
				Math.abs(right.from + right.durationInFrames / 2 - rangeCenter)
		);
	for (const item of wideVisibleItems) {
		if (nativeById.size >= MAX_DENSE_NATIVE_ITEMS) break;
		nativeById.set(item.id, item);
	}
	const selectedSet = new Set(args.selectedItemIds);
	const densityBuckets = (
		args.densityBuckets ?? buildTimelineDensityBuckets(args.index.items)
	).filter(
		(bucket) =>
			(bucket.from + bucket.durationInFrames > args.range.start && bucket.from < args.range.end) ||
			bucket.items.some((item) => selectedSet.has(item.id))
	);

	return {
		nativeItems: orderIndexedItems(nativeById, args.index),
		densityBuckets,
		isDense,
		range: args.range
	};
}

export interface TimelineNavigatorMetrics {
	maxScrollLeft: number;
	thumbWidth: number;
	thumbTravel: number;
	thumbLeft: number;
}

export interface TimelineNavigatorPanResult {
	thumbLeft: number;
	scrollLeft: number;
}

export interface TimelineNavigatorResizeResult {
	zoomLevel: number;
	scrollLeft: number;
	thumbLeft: number;
	thumbWidth: number;
}

export function timelineNavigatorMetrics(args: {
	timelineWidth: number;
	viewportWidth: number;
	trackWidth: number;
	scrollLeft: number;
	minThumbWidth?: number;
}): TimelineNavigatorMetrics {
	const timelineWidth = Math.max(1, args.viewportWidth, args.timelineWidth);
	const maxScrollLeft = Math.max(0, timelineWidth - args.viewportWidth);
	const widthRatio = args.viewportWidth > 0 ? Math.min(1, args.viewportWidth / timelineWidth) : 1;
	const thumbWidth =
		args.trackWidth <= 0
			? 0
			: widthRatio >= 1
				? args.trackWidth
				: Math.min(
						args.trackWidth,
						Math.max(
							args.minThumbWidth ?? TIMELINE_NAVIGATOR_MIN_THUMB_PX,
							widthRatio * args.trackWidth
						)
					);
	const thumbTravel = Math.max(0, args.trackWidth - thumbWidth);
	const thumbLeft =
		maxScrollLeft > 0 && thumbTravel > 0
			? (Math.min(maxScrollLeft, Math.max(0, args.scrollLeft)) / maxScrollLeft) * thumbTravel
			: 0;
	return { maxScrollLeft, thumbWidth, thumbTravel, thumbLeft };
}

export function timelineNavigatorPan(args: {
	startThumbLeft: number;
	deltaX: number;
	thumbTravel: number;
	maxScrollLeft: number;
}): TimelineNavigatorPanResult {
	const thumbLeft = Math.min(args.thumbTravel, Math.max(0, args.startThumbLeft + args.deltaX));
	return {
		thumbLeft,
		scrollLeft: args.thumbTravel > 0 ? (thumbLeft / args.thumbTravel) * args.maxScrollLeft : 0
	};
}

export function timelineNavigatorResize(args: {
	handle: 'left' | 'right';
	deltaX: number;
	startThumbLeft: number;
	startThumbWidth: number;
	trackWidth: number;
	viewportWidth: number;
	headerWidth: number;
	contentFrames: number;
	minThumbWidth?: number;
}): TimelineNavigatorResizeResult {
	const minThumb = Math.min(args.minThumbWidth ?? TIMELINE_NAVIGATOR_MIN_THUMB_PX, args.trackWidth);
	const requestedWidth =
		args.handle === 'left'
			? args.startThumbWidth - args.deltaX
			: args.startThumbWidth + args.deltaX;
	const thumbWidth = Math.min(args.trackWidth, Math.max(minThumb, requestedWidth));
	const desiredTimelineWidth =
		thumbWidth > 0
			? Math.max(args.viewportWidth, (args.viewportWidth * args.trackWidth) / thumbWidth)
			: args.viewportWidth;
	const contentFrames = Math.max(1, args.contentFrames);
	const zoomLevel = clampTimelineZoom(
		Math.max(800, desiredTimelineWidth - args.headerWidth) /
			contentFrames /
			TIMELINE_PIXELS_PER_FRAME_AT_100
	);
	const timelineWidth =
		args.headerWidth + Math.max(800, contentFrames * timelinePixelsPerFrame(zoomLevel));
	const metrics = timelineNavigatorMetrics({
		timelineWidth,
		viewportWidth: args.viewportWidth,
		trackWidth: args.trackWidth,
		scrollLeft: 0,
		minThumbWidth: args.minThumbWidth
	});
	const fixedRight = args.startThumbLeft + args.startThumbWidth;
	const thumbLeft =
		args.handle === 'left'
			? Math.min(metrics.thumbTravel, Math.max(0, fixedRight - metrics.thumbWidth))
			: Math.min(metrics.thumbTravel, Math.max(0, args.startThumbLeft));
	return {
		zoomLevel,
		scrollLeft:
			metrics.thumbTravel > 0 ? (thumbLeft / metrics.thumbTravel) * metrics.maxScrollLeft : 0,
		thumbLeft,
		thumbWidth: metrics.thumbWidth
	};
}
