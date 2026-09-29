import type { TimelineItemKind, TimelineTrack } from '../../project/types';
import { planOpenTrackForRange } from '../track-occupancy';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../utils/track-groups';
import { MIN_TRACK_HEIGHT } from '../track-resize';

export function ensureOpenTrackForRange(options: {
	kind: 'video' | 'audio';
	itemType: TimelineItemKind;
	from: number;
	durationInFrames: number;
	label: string;
	preferredTrackId?: string;
	ignoredItemIds?: ReadonlySet<string>;
	stacking?: 'top' | 'bottom';
}): TimelineTrack {
	const plan = planOpenTrackForRange({
		...options,
		stacking: options.stacking ?? (options.itemType === 'subtitle' ? 'top' : undefined),
		tracks: effectiveMediaTracks(timelineStore.tracks),
		items: timelineStore.items,
		createId: () => crypto.randomUUID()
	});
	if (
		options.itemType === 'subtitle' &&
		(plan.created || !timelineStore.items.some((item) => item.trackId === plan.track.id))
	) {
		plan.track = { ...plan.track, height: MIN_TRACK_HEIGHT };
		if (!plan.created) {
			timelineStore._setTracks(
				timelineStore.tracks.map((track) =>
					track.id === plan.track.id ? { ...track, height: MIN_TRACK_HEIGHT } : track
				)
			);
		}
	}
	if (plan.created) timelineStore._setTracks([...timelineStore.tracks, plan.track]);
	return plan.track;
}
