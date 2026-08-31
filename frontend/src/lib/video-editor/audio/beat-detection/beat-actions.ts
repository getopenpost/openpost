import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { executeAtomic } from '$lib/video-editor/timeline/commands/command-store.svelte';
import type { TimelineMarker } from '$lib/video-editor/project/types';
import { dedupeAgainstExisting } from './marker-mapping';

export function addBeatMarkersAtomic(markers: TimelineMarker[]): number {
	if (markers.length === 0) return 0;
	return executeAtomic('ADD_BEAT_MARKERS', () => {
		const deduped = dedupeAgainstExisting(markers, timelineStore.markers, 1);
		if (deduped.length === 0) return 0;
		const merged = [...timelineStore.markers, ...deduped].sort(
			(a, b) => a.frame - b.frame || a.id.localeCompare(b.id)
		);
		timelineStore._setMarkers(merged);
		return deduped.length;
	});
}
