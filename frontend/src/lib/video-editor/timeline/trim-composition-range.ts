import type {
	TimelineItem,
	TimelineMarker,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { isTrackEffectivelyLocked } from './utils/track-groups';
import { calculateTrimSourceUpdate } from './utils/trim-utils';

export type TrimCompositionRangePlan =
	| { ok: false; reason: 'locked-track' }
	| {
			ok: true;
			updates: Array<{ id: string; patch: Partial<TimelineItem> }>;
			removeIds: string[];
			transitions: TimelineTransition[];
			markers: TimelineMarker[];
			durationInFrames: number;
			currentFrame: number;
	  };

interface TrimCompositionRangeInput {
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions: readonly TimelineTransition[];
	markers: readonly TimelineMarker[];
	inPoint: number;
	outPoint: number;
	currentFrame: number;
	fps: number;
}

function itemChanges(item: TimelineItem, inPoint: number, outPoint: number): boolean {
	const end = item.from + item.durationInFrames;
	return inPoint > 0 || item.from < inPoint || end > outPoint;
}

function trimItemToRange(
	item: TimelineItem,
	inPoint: number,
	outPoint: number,
	fps: number
): Partial<TimelineItem> | null {
	const itemEnd = item.from + item.durationInFrames;
	const overlapStart = Math.max(item.from, inPoint);
	const overlapEnd = Math.min(itemEnd, outPoint);
	if (overlapEnd <= overlapStart) return null;

	const startCut = overlapStart - item.from;
	const endCut = itemEnd - overlapEnd;
	const durationAfterStart = item.durationInFrames - startCut;
	let working: TimelineItem = {
		...item,
		from: overlapStart,
		durationInFrames: durationAfterStart
	};
	const startSourceUpdate =
		startCut > 0
			? calculateTrimSourceUpdate(item, 'start', startCut, durationAfterStart, fps)
			: null;
	if (startSourceUpdate) working = { ...working, ...startSourceUpdate };

	const durationInFrames = durationAfterStart - endCut;
	const endSourceUpdate =
		endCut > 0 ? calculateTrimSourceUpdate(working, 'end', -endCut, durationInFrames, fps) : null;
	return {
		from: overlapStart - inPoint,
		durationInFrames,
		...(startSourceUpdate ?? {}),
		...(endSourceUpdate ?? {})
	};
}

export function planTrimCompositionToRange(
	input: TrimCompositionRangeInput
): TrimCompositionRangePlan {
	const inPoint = Math.max(0, Math.round(input.inPoint));
	const outPoint = Math.max(inPoint + 1, Math.round(input.outPoint));
	if (
		input.items.some(
			(item) =>
				itemChanges(item, inPoint, outPoint) && isTrackEffectivelyLocked(item.trackId, input.tracks)
		)
	) {
		return { ok: false, reason: 'locked-track' };
	}

	const updates: Array<{ id: string; patch: Partial<TimelineItem> }> = [];
	const removeIds: string[] = [];
	for (const item of input.items) {
		const patch = trimItemToRange(item, inPoint, outPoint, input.fps);
		if (!patch) {
			removeIds.push(item.id);
			continue;
		}
		if (
			patch.from !== item.from ||
			patch.durationInFrames !== item.durationInFrames ||
			(patch.sourceStart !== undefined && patch.sourceStart !== item.sourceStart) ||
			(patch.sourceEnd !== undefined && patch.sourceEnd !== item.sourceEnd)
		) {
			updates.push({ id: item.id, patch });
		}
	}

	const removed = new Set(removeIds);
	const durationInFrames = outPoint - inPoint;
	return {
		ok: true,
		updates,
		removeIds,
		transitions: input.transitions.filter(
			(transition) => !removed.has(transition.fromItemId) && !removed.has(transition.toItemId)
		),
		markers: input.markers
			.filter((marker) => marker.frame >= inPoint && marker.frame < outPoint)
			.map((marker) => ({ ...marker, frame: marker.frame - inPoint })),
		durationInFrames,
		currentFrame: Math.max(0, Math.min(durationInFrames - 1, input.currentFrame - inPoint))
	};
}
