import type { TimelineItem, TimelineItemKind, TimelineTrack } from '../project/types';

export type TimelineOccupancyItem = Pick<
	TimelineItem,
	'id' | 'trackId' | 'from' | 'durationInFrames' | 'type'
>;

/** Audio mixes, adjustments stack, and transform controllers do not exclusively occupy a track. */
export function exclusivelyOccupiesTrack(item: Pick<TimelineOccupancyItem, 'type'>): boolean {
	return item.type !== 'audio' && item.type !== 'adjustment' && item.type !== 'controller';
}

export function timelineRangesOverlap(
	left: Pick<TimelineOccupancyItem, 'from' | 'durationInFrames'>,
	right: Pick<TimelineOccupancyItem, 'from' | 'durationInFrames'>
): boolean {
	return (
		left.from < right.from + right.durationInFrames &&
		left.from + left.durationInFrames > right.from
	);
}

export function trackRangeIsOpen(
	items: readonly TimelineOccupancyItem[],
	trackId: string,
	from: number,
	durationInFrames: number,
	itemType: TimelineItemKind,
	ignoredItemIds: ReadonlySet<string> = new Set()
): boolean {
	const candidate = { from, durationInFrames, type: itemType };
	if (!exclusivelyOccupiesTrack(candidate)) return true;
	return items.every(
		(item) =>
			item.trackId !== trackId ||
			ignoredItemIds.has(item.id) ||
			!exclusivelyOccupiesTrack(item) ||
			!timelineRangesOverlap(candidate, item)
	);
}

export interface OpenTrackPlan {
	track: TimelineTrack;
	created: boolean;
}

/** Choose an unlocked compatible track, or describe a new outer track without mutating state. */
export function planOpenTrackForRange(options: {
	tracks: readonly TimelineTrack[];
	items: readonly TimelineOccupancyItem[];
	kind: 'video' | 'audio';
	itemType: TimelineItemKind;
	from: number;
	durationInFrames: number;
	label: string;
	preferredTrackId?: string;
	ignoredItemIds?: ReadonlySet<string>;
	stacking?: 'top' | 'bottom';
	createId: () => string;
}): OpenTrackPlan {
	const ignoredItemIds = options.ignoredItemIds ?? new Set<string>();
	const compatible = options.tracks
		.filter(
			(track) =>
				!track.isGroup &&
				track.kind === options.kind &&
				!track.locked &&
				(track.visible !== false || track.id === options.preferredTrackId)
		)
		.toSorted((left, right) => {
			if (options.kind === 'audio') return right.order - left.order;
			return options.stacking === 'bottom' ? right.order - left.order : left.order - right.order;
		});
	const preferred = options.preferredTrackId
		? compatible.find((track) => track.id === options.preferredTrackId)
		: undefined;
	const candidates = preferred
		? [preferred, ...compatible.filter((track) => track.id !== preferred.id)]
		: compatible;
	const occupiedOrders =
		options.stacking && options.kind === 'video'
			? options.tracks
					.filter(
						(track) =>
							track.kind === 'video' &&
							track.visible &&
							options.items.some(
								(item) =>
									item.trackId === track.id &&
									!ignoredItemIds.has(item.id) &&
									exclusivelyOccupiesTrack(item) &&
									timelineRangesOverlap(options, item)
							)
					)
					.map((track) => track.order)
			: [];
	const open = candidates.find(
		(track) =>
			(track.id === preferred?.id ||
				occupiedOrders.length === 0 ||
				(options.stacking === 'top'
					? track.order < Math.min(...occupiedOrders)
					: track.order > Math.max(...occupiedOrders))) &&
			trackRangeIsOpen(
				options.items,
				track.id,
				options.from,
				options.durationInFrames,
				options.itemType,
				ignoredItemIds
			)
	);
	if (open) return { track: open, created: false };

	const orders = options.tracks.map((track) => track.order);
	return {
		created: true,
		track: {
			id: options.createId(),
			name: options.label,
			kind: options.kind,
			height: options.kind === 'video' ? 96 : 72,
			locked: false,
			syncLock: true,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order:
				options.kind === 'video' && options.stacking !== 'bottom'
					? (orders.length > 0 ? Math.min(...orders) : 0) - 1
					: (orders.length > 0 ? Math.max(...orders) : -1) + 1
		}
	};
}

/**
 * Clamp one shared move delta against static items on every participant track.
 * Items that already overlap are ignored so old projects can move those clips apart.
 */
export function clampMoveDeltaToTrackGaps(
	items: readonly TimelineOccupancyItem[],
	participantIds: ReadonlySet<string>,
	requestedDelta: number
): number {
	const participants = items.filter((item) => participantIds.has(item.id));
	let delta = requestedDelta;
	for (const participant of participants) delta = Math.max(delta, -participant.from);
	if (delta === 0) return 0;
	const forward = delta > 0;
	const boundariesByTrack = new Map<string, number[]>();
	for (const other of items) {
		if (participantIds.has(other.id) || !exclusivelyOccupiesTrack(other)) continue;
		const boundary = forward ? other.from : other.from + other.durationInFrames;
		if (Number.isNaN(boundary)) continue;
		const boundaries = boundariesByTrack.get(other.trackId);
		if (boundaries) boundaries.push(boundary);
		else boundariesByTrack.set(other.trackId, [boundary]);
	}
	for (const boundaries of boundariesByTrack.values())
		boundaries.sort((left, right) => left - right);

	for (const participant of participants) {
		if (!exclusivelyOccupiesTrack(participant)) continue;
		const boundaries = boundariesByTrack.get(participant.trackId);
		if (!boundaries) continue;
		const edge = forward ? participant.from + participant.durationInFrames : participant.from;
		if (Number.isNaN(edge)) continue;
		const index = forward
			? firstBoundaryAtOrAfter(boundaries, edge)
			: firstBoundaryAfter(boundaries, edge) - 1;
		const boundary = boundaries[index];
		if (boundary === undefined) continue;
		delta = forward ? Math.min(delta, boundary - edge) : Math.max(delta, boundary - edge);
		if (delta === 0) return delta;
	}

	return delta;
}

function firstBoundaryAtOrAfter(boundaries: readonly number[], frame: number): number {
	let start = 0;
	let end = boundaries.length;
	while (start < end) {
		const middle = (start + end) >>> 1;
		if (boundaries[middle]! < frame) start = middle + 1;
		else end = middle;
	}
	return start;
}

function firstBoundaryAfter(boundaries: readonly number[], frame: number): number {
	let start = 0;
	let end = boundaries.length;
	while (start < end) {
		const middle = (start + end) >>> 1;
		if (boundaries[middle]! <= frame) start = middle + 1;
		else end = middle;
	}
	return start;
}

/** Find one forward shift that keeps a planned group clear of every existing item. */
export function findForwardOpenTrackShift(
	plannedItems: readonly TimelineOccupancyItem[],
	existingItems: readonly TimelineOccupancyItem[]
): number | null {
	for (let index = 0; index < plannedItems.length; index += 1) {
		const left = plannedItems[index]!;
		for (const right of plannedItems.slice(index + 1)) {
			if (
				exclusivelyOccupiesTrack(left) &&
				exclusivelyOccupiesTrack(right) &&
				left.trackId === right.trackId &&
				timelineRangesOverlap(left, right)
			) {
				return null;
			}
		}
	}

	let shift = 0;
	while (true) {
		let nextShift = shift;
		for (const planned of plannedItems) {
			if (!exclusivelyOccupiesTrack(planned)) continue;
			const candidate = { ...planned, from: planned.from + shift };
			for (const existing of existingItems) {
				if (
					!exclusivelyOccupiesTrack(existing) ||
					candidate.trackId !== existing.trackId ||
					!timelineRangesOverlap(candidate, existing)
				) {
					continue;
				}
				nextShift = Math.max(nextShift, existing.from + existing.durationInFrames - planned.from);
			}
		}
		if (nextShift === shift) return shift;
		shift = nextShift;
	}
}

export interface TimelineOccupancyUpdate {
	id: string;
	patch: Partial<Pick<TimelineOccupancyItem, 'trackId' | 'from' | 'durationInFrames' | 'type'>>;
}

/** Reject only new exclusive-track collisions, leaving pre-existing overlap relationships intact. */
export function updatesIntroduceExclusiveTrackOverlap(
	items: readonly TimelineOccupancyItem[],
	updates: readonly TimelineOccupancyUpdate[]
): boolean {
	const originalById = new Map(items.map((item) => [item.id, item]));
	const patchById = new Map(updates.map((update) => [update.id, update.patch]));
	const affectedIds = new Set(patchById.keys());
	const plannedItems = items.map((item) => ({ ...item, ...patchById.get(item.id) }));
	const tracks = new Map<string, { items: TimelineOccupancyItem[]; maximumEnds: number[] }>();
	for (const planned of plannedItems) {
		if (
			!exclusivelyOccupiesTrack(planned) ||
			Number.isNaN(planned.from) ||
			Number.isNaN(planned.from + planned.durationInFrames)
		)
			continue;
		const track = tracks.get(planned.trackId);
		if (track) track.items.push(planned);
		else tracks.set(planned.trackId, { items: [planned], maximumEnds: [] });
	}
	for (const track of tracks.values()) {
		track.items.sort((left, right) => left.from - right.from);
		let maximumEnd = -Infinity;
		track.maximumEnds = track.items.map((item) => {
			maximumEnd = Math.max(maximumEnd, item.from + item.durationInFrames);
			return maximumEnd;
		});
	}

	for (const planned of plannedItems) {
		if (!affectedIds.has(planned.id) || !exclusivelyOccupiesTrack(planned)) continue;
		const track = tracks.get(planned.trackId);
		if (!track) continue;
		const first = firstBoundaryAfter(track.maximumEnds, planned.from);
		const end = planned.from + planned.durationInFrames;
		for (let index = first; index < track.items.length && track.items[index]!.from < end; index++) {
			const other = track.items[index]!;
			if (planned.id === other.id || !timelineRangesOverlap(planned, other)) {
				continue;
			}

			const original = originalById.get(planned.id)!;
			const originalOther = originalById.get(other.id)!;
			const alreadyOverlapped =
				exclusivelyOccupiesTrack(original) &&
				exclusivelyOccupiesTrack(originalOther) &&
				original.trackId === originalOther.trackId &&
				timelineRangesOverlap(original, originalOther);
			if (!alreadyOverlapped) return true;
		}
	}

	return false;
}
