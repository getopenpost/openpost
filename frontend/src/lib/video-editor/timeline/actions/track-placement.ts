import type { TimelineItemKind, TimelineTrack } from '../../project/types';
import { planOpenTrackForRange } from '../track-occupancy';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../utils/track-groups';

export function ensureOpenTrackForRange(options: {
	kind: 'video' | 'audio';
	itemType: TimelineItemKind;
	from: number;
	durationInFrames: number;
	label: string;
	preferredTrackId?: string;
	ignoredItemIds?: ReadonlySet<string>;
}): TimelineTrack {
	const plan = planOpenTrackForRange({
		...options,
		tracks: effectiveMediaTracks(timelineStore.tracks),
		items: timelineStore.items,
		createId: () => crypto.randomUUID()
	});
	if (plan.created) timelineStore._setTracks([...timelineStore.tracks, plan.track]);
	return plan.track;
}
