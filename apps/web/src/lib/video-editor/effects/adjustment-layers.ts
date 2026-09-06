/** Adjustment-layer scope and effect ordering shared by preview and export. */

import type { ItemEffect } from './types';
import { resolveAnimatedEffectsAt } from './effect-keyframes';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import { withoutColorGradeEffects } from './color-grade';

export interface AdjustmentLayerScope {
	layer: TimelineItem;
	trackOrder: number;
}

/** Collect adjustment layers from visible tracks with their compositing order. */
export function collectAdjustmentLayers(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[]
): AdjustmentLayerScope[] {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const orderByTrack = new Map(resolvedTracks.map((track) => [track.id, track.order]));
	const anySolo = resolvedTracks.some((track) => track.solo);
	const visibleTracks = new Set(
		resolvedTracks
			.filter((track) => (anySolo ? track.solo : track.visible !== false))
			.map((track) => track.id)
	);
	return items.flatMap((item) =>
		item.type === 'adjustment' &&
		(item.sequenceColorGrade === true || visibleTracks.has(item.trackId))
			? [{ layer: item, trackOrder: orderByTrack.get(item.trackId) ?? 0 }]
			: []
	);
}

/**
 * Resolve the effects that apply to one visual item at a frame. Adjustment
 * effects run from top to bottom first, followed by the item's own stack.
 */
export function effectsForItemAtFrame(
	item: TimelineItem,
	itemTrackOrder: number,
	adjustmentLayers: readonly AdjustmentLayerScope[],
	frame: number,
	excludedColorGradeItemIds: ReadonlySet<string> = new Set()
): ItemEffect[] {
	const adjustmentEffects = adjustmentLayers
		.filter(
			({ layer, trackOrder }) =>
				itemTrackOrder > trackOrder &&
				layer.sequenceColorGrade !== true &&
				frame >= layer.from &&
				frame < layer.from + layer.durationInFrames
		)
		.toSorted((left, right) => left.trackOrder - right.trackOrder)
		.flatMap(({ layer }) => {
			const effects = (layer.effects ?? []).filter((effect) => effect.enabled);
			return excludedColorGradeItemIds.has(layer.id) ? withoutColorGradeEffects(effects) : effects;
		});
	const itemEffects = (item.effects ?? []).filter((effect) => effect.enabled);
	return [
		...adjustmentEffects,
		...(excludedColorGradeItemIds.has(item.id)
			? withoutColorGradeEffects(itemEffects)
			: itemEffects)
	];
}

/** Resolve sequence-owned effects once, after the frame has been composited. */
export function sequenceColorGradeEffectsAtFrame(
	adjustmentLayers: readonly AdjustmentLayerScope[],
	frame: number
): ItemEffect[] {
	return adjustmentLayers
		.filter(({ layer }) => layer.sequenceColorGrade === true)
		.toSorted((left, right) => left.trackOrder - right.trackOrder)
		.flatMap(({ layer }) =>
			(resolveAnimatedEffectsAt(layer, frame) ?? []).filter((effect) => effect.enabled)
		);
}
