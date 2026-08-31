import type { TimelineItem, TimelineTrack } from '../project/types';
import { clonePropertyRuntime } from './property-runtime-clone';

export function copyTimelineItems(items: readonly TimelineItem[]): TimelineItem[] {
	if (items.length === 0) return [];
	const earliestFrame = Math.min(...items.map((item) => item.from));
	return items.map((item) => ({
		...structuredClone(item),
		from: item.from - earliestFrame
	}));
}

function trackAcceptsItem(track: TimelineTrack, item: TimelineItem): boolean {
	if (track.isGroup || track.locked) return false;
	return item.type === 'audio' ? track.kind === 'audio' : track.kind !== 'audio';
}

function resolvePasteTrack(
	item: TimelineItem,
	tracks: readonly TimelineTrack[],
	activeTrackId: string | null,
	preserveSourceTracks: boolean
): string | null {
	const sourceTrack = tracks.find((track) => track.id === item.trackId);
	if (preserveSourceTracks && sourceTrack && trackAcceptsItem(sourceTrack, item)) {
		return sourceTrack.id;
	}
	const activeTrack = activeTrackId
		? tracks.find((track) => track.id === activeTrackId)
		: undefined;
	if (!preserveSourceTracks && activeTrack && trackAcceptsItem(activeTrack, item)) {
		return activeTrack.id;
	}
	if (sourceTrack && trackAcceptsItem(sourceTrack, item)) return sourceTrack.id;
	return (
		tracks
			.filter((track) => trackAcceptsItem(track, item))
			.toSorted((left, right) => left.order - right.order)[0]?.id ?? null
	);
}

function overlaps(
	leftStart: number,
	leftDuration: number,
	rightStart: number,
	rightDuration: number
): boolean {
	return leftStart < rightStart + rightDuration && leftStart + leftDuration > rightStart;
}

interface PlannedTrackItem {
	item: TimelineItem;
	trackId: string;
}

function sharedPasteBase(
	planned: readonly PlannedTrackItem[],
	currentFrame: number,
	existingItems: readonly TimelineItem[]
): number {
	let base = Math.max(0, Math.round(currentFrame));
	while (true) {
		let nextBase = base;
		for (const { item, trackId } of planned) {
			const desiredFrom = base + item.from;
			for (const existing of existingItems) {
				if (
					existing.trackId === trackId &&
					overlaps(desiredFrom, item.durationInFrames, existing.from, existing.durationInFrames)
				) {
					nextBase = Math.max(nextBase, existing.from + existing.durationInFrames - item.from);
				}
			}
		}
		if (nextBase === base) return base;
		base = nextBase;
	}
}

export function planTimelineClipboardPaste({
	clipboard,
	currentFrame,
	existingItems,
	tracks,
	activeTrackId,
	createId = () => crypto.randomUUID()
}: {
	clipboard: readonly TimelineItem[];
	currentFrame: number;
	existingItems: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	activeTrackId: string | null;
	createId?: () => string;
}): TimelineItem[] {
	const preserveSourceTracks = new Set(clipboard.map((item) => item.trackId)).size > 1;
	const targetTrackBySourceTrack = new Map<string, string>();
	const planned: PlannedTrackItem[] = [];
	for (const item of clipboard) {
		const existingTarget = targetTrackBySourceTrack.get(item.trackId);
		const trackId =
			existingTarget ?? resolvePasteTrack(item, tracks, activeTrackId, preserveSourceTracks);
		if (!trackId) continue;
		targetTrackBySourceTrack.set(item.trackId, trackId);
		planned.push({ item, trackId });
	}
	if (planned.length === 0) return [];

	const base = sharedPasteBase(planned, currentFrame, existingItems);
	const newIdByOldId = new Map(planned.map(({ item }) => [item.id, createId()]));
	const newLinkedGroupByOldId = new Map<string, string>();
	return planned.map(({ item, trackId }) => {
		const id = newIdByOldId.get(item.id)!;
		let linkedGroupId: string | undefined;
		if (item.linkedGroupId) {
			linkedGroupId = newLinkedGroupByOldId.get(item.linkedGroupId);
			if (!linkedGroupId) {
				linkedGroupId = createId();
				newLinkedGroupByOldId.set(item.linkedGroupId, linkedGroupId);
			}
		}
		return {
			...structuredClone(item),
			...clonePropertyRuntime(item, newIdByOldId),
			id,
			originId: id,
			trackId,
			from: base + item.from,
			linkedGroupId
		};
	});
}
