import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { captureSnapshot } from '../timeline/commands/snapshot.svelte';

export function buildAgentFingerprint(selectedIds: readonly string[] = []): string {
	const snapshot = captureSnapshot();
	return JSON.stringify({
		items: snapshot.items,
		tracks: snapshot.tracks,
		transitions: snapshot.transitions,
		markers: snapshot.markers,
		inPoint: snapshot.inPoint,
		outPoint: snapshot.outPoint,
		fps: snapshot.fps,
		currentFrame: snapshot.currentFrame,
		masterVolumeDb: snapshot.masterVolumeDb,
		masterMuted: snapshot.masterMuted,
		busAudioEq: snapshot.busAudioEq,
		sequenceRegistry: snapshot.sequenceRegistry,
		linkedSelectionEnabled: timelineStore.linkedSelectionEnabled,
		seekLocked: timelineStore.seekLocked,
		selectedIds: [...selectedIds].sort()
	});
}
