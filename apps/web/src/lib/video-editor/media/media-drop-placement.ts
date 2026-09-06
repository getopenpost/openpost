import type { MediaMetadata } from './types';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { effectiveTrackState, isTrackGroup } from '../timeline/utils/track-groups';

export type MediaTimelineKind = 'video' | 'audio';
export type MediaDropRejection =
	| 'missing-track'
	| 'group-track'
	| 'wrong-kind'
	| 'locked'
	| 'hidden'
	| 'collision';

export interface ExactMediaPlacement {
	trackId: string;
	from: number;
	durationInFrames: number;
}

export type ExactMediaPlacementResult =
	| { valid: true; placement: ExactMediaPlacement }
	| { valid: false; reason: MediaDropRejection };

export interface ExactSequencePlacementPlan {
	visualTrackId?: string;
	audioTrackId?: string;
}

export interface CompositionMediaNeeds {
	visual: boolean;
	audio: boolean;
}

export function mediaTimelineKind(media: MediaMetadata): MediaTimelineKind {
	return media.tags.includes('audio') ? 'audio' : 'video';
}

export function mediaDurationInFrames(media: MediaMetadata, fps: number): number {
	if (media.tags.includes('image')) {
		if ((media.animationFrameCount ?? 0) > 1 && media.duration > 0) {
			return Math.max(1, Math.round(media.duration * fps));
		}
		return Math.max(1, Math.round(3 * fps));
	}
	return Math.max(1, Math.round(Math.max(media.duration, 1 / fps) * fps));
}

export function placementCollides(
	trackId: string,
	from: number,
	durationInFrames: number,
	items: readonly Pick<TimelineItem, 'trackId' | 'from' | 'durationInFrames'>[]
): boolean {
	const end = from + durationInFrames;
	return items.some(
		(item) =>
			item.trackId === trackId && item.from < end && item.from + item.durationInFrames > from
	);
}

export function mediaDropAutoScrollDelta(
	clientX: number,
	left: number,
	right: number,
	maxStep = 18
): number {
	const width = Math.max(0, right - left);
	if (width === 0) return 0;
	const edgeSize = Math.min(72, width * 0.2);
	if (clientX < left + edgeSize) {
		return -maxStep * Math.min(1, (left + edgeSize - clientX) / edgeSize);
	}
	if (clientX > right - edgeSize) {
		return maxStep * Math.min(1, (clientX - (right - edgeSize)) / edgeSize);
	}
	return 0;
}

/** Validate the exact row and frame shown by the drop ghost. Never selects another track. */
export function evaluateExactMediaPlacement(options: {
	trackId: string;
	from: number;
	durationInFrames: number;
	kind: MediaTimelineKind;
	tracks: readonly TimelineTrack[];
	items: readonly Pick<TimelineItem, 'trackId' | 'from' | 'durationInFrames'>[];
}): ExactMediaPlacementResult {
	const track = options.tracks.find((candidate) => candidate.id === options.trackId);
	if (!track) return { valid: false, reason: 'missing-track' };
	if (isTrackGroup(track)) return { valid: false, reason: 'group-track' };
	if (track.kind !== options.kind) return { valid: false, reason: 'wrong-kind' };
	const state = effectiveTrackState(track, [...options.tracks]);
	if (state.locked) return { valid: false, reason: 'locked' };
	if (state.visible === false) return { valid: false, reason: 'hidden' };
	const placement = {
		trackId: track.id,
		from: Math.max(0, Math.round(options.from)),
		durationInFrames: Math.max(1, Math.round(options.durationInFrames))
	};
	if (
		placementCollides(placement.trackId, placement.from, placement.durationInFrames, options.items)
	) {
		return { valid: false, reason: 'collision' };
	}
	return { valid: true, placement };
}

export function compositionMediaNeeds(composition: SubComposition): CompositionMediaNeeds {
	return {
		visual: composition.items.some((item) => item.type !== 'audio'),
		audio: composition.items.some((item) => item.type === 'audio' || item.type === 'video')
	};
}

/** Plan every wrapper for a sequence drop before the UI shows it as valid. */
export function planExactSequencePlacement(options: {
	composition: SubComposition;
	preferredTrackId: string;
	from: number;
	tracks: readonly TimelineTrack[];
	items: readonly Pick<TimelineItem, 'trackId' | 'from' | 'durationInFrames'>[];
}):
	| { valid: true; placement: ExactSequencePlacementPlan }
	| { valid: false; reason: MediaDropRejection } {
	const needs = compositionMediaNeeds(options.composition);
	if (!needs.visual && !needs.audio) return { valid: false, reason: 'missing-track' };
	const durationInFrames = Math.max(1, options.composition.durationInFrames);
	const primaryKind: MediaTimelineKind = needs.visual ? 'video' : 'audio';
	const primary = evaluateExactMediaPlacement({
		trackId: options.preferredTrackId,
		from: options.from,
		durationInFrames,
		kind: primaryKind,
		tracks: options.tracks,
		items: options.items
	});
	if (!primary.valid) return primary;
	const placement: ExactSequencePlacementPlan = needs.visual
		? { visualTrackId: primary.placement.trackId }
		: { audioTrackId: primary.placement.trackId };
	if (!needs.audio || !needs.visual) return { valid: true, placement };

	const audioCandidates = [...options.tracks]
		.filter((track) => !isTrackGroup(track) && track.kind === 'audio')
		.toSorted((left, right) => right.order - left.order);
	let firstRejection: MediaDropRejection = 'missing-track';
	for (const track of audioCandidates) {
		const result = evaluateExactMediaPlacement({
			trackId: track.id,
			from: options.from,
			durationInFrames,
			kind: 'audio',
			tracks: options.tracks,
			items: options.items
		});
		if (result.valid) {
			return {
				valid: true,
				placement: { ...placement, audioTrackId: result.placement.trackId }
			};
		}
		firstRejection = result.reason;
	}
	return { valid: false, reason: firstRejection };
}
