/**
 * Snapshot capture/restore/equality over the timeline store.
 *
 * All store updates happen synchronously so undo/redo never exposes
 * intermediate states. Equality uses reference comparison — actions must
 * replace arrays/objects rather than mutate them in place for history
 * deduplication to work (the private mutators re-index and mark dirty but
 * the action layer replaces `items` via `_setItems` when shapes change).
 *
 * Ported from FreeCut (MIT) — commands/snapshot.ts.
 */

import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from '../actions/transitions.svelte';
import { sanitizeInOutPoints } from '../utils/in-out-points';
import type { TimelineSnapshot } from './types';
import { sequenceStore } from '../../sequences/sequence-store.svelte';
import type { SequenceRegistrySnapshot } from '../../sequences/sequence-store.svelte';

export function captureSnapshot(): TimelineSnapshot {
	// Deep-copy items/tracks: the store mutates item objects in place during
	// edits (e.g. _splitItem shrinks the left piece), which would otherwise
	// corrupt captured snapshots sharing those references.
	return {
		items: $state.snapshot(timelineStore.items),
		tracks: $state.snapshot(timelineStore.tracks),
		transitions: $state.snapshot(transitionsStore.list),
		markers: $state.snapshot(timelineStore.markers),
		inPoint: timelineStore.inPoint,
		outPoint: timelineStore.outPoint,
		fps: timelineStore.fps,
		scrollPosition: timelineStore.scrollPosition,
		snapEnabled: timelineStore.snapEnabled,
		currentFrame: timelineStore.currentFrame,
		masterVolumeDb: timelineStore.masterVolumeDb,
		masterMuted: timelineStore.masterMuted,
		busAudioEq: $state.snapshot(timelineStore.busAudioEq),
		sequenceRegistry: sequenceStore.snapshotRegistry()
	};
}

export function restoreSnapshot(
	snapshot: TimelineSnapshot,
	registryFrom?: SequenceRegistrySnapshot
): void {
	const plainSnapshot = $state.snapshot(snapshot);
	if (registryFrom) {
		sequenceStore.applyRegistryDelta($state.snapshot(registryFrom), plainSnapshot.sequenceRegistry);
	} else {
		sequenceStore.restoreRegistry(plainSnapshot.sequenceRegistry);
	}
	const sanitized = sanitizeInOutPoints({
		inPoint: plainSnapshot.inPoint,
		outPoint: plainSnapshot.outPoint,
		maxFrame: plainSnapshot.items.reduce(
			(max, item) => Math.max(max, item.from + item.durationInFrames),
			0
		)
	});
	transitionsStore.setAll(plainSnapshot.transitions);
	timelineStore.setAll({
		items: plainSnapshot.items,
		tracks: plainSnapshot.tracks,
		markers: plainSnapshot.markers,
		inPoint: sanitized.inPoint,
		outPoint: sanitized.outPoint,
		currentFrame: plainSnapshot.currentFrame,
		fps: plainSnapshot.fps,
		masterVolumeDb: plainSnapshot.masterVolumeDb,
		masterMuted: plainSnapshot.masterMuted,
		busAudioEq: plainSnapshot.busAudioEq
	});
	timelineStore._setScrollPosition(plainSnapshot.scrollPosition);
	timelineStore._setSnapEnabled(plainSnapshot.snapEnabled);
}

export function snapshotsEqual(a: TimelineSnapshot, b: TimelineSnapshot): boolean {
	// Snapshots are deep copies (captureSnapshot clones), so equality is
	// structural: JSON comparison keeps history dedup honest despite the
	// store mutating item objects in place during edits.
	return (
		JSON.stringify(a.items) === JSON.stringify(b.items) &&
		JSON.stringify(a.tracks) === JSON.stringify(b.tracks) &&
		JSON.stringify(a.transitions) === JSON.stringify(b.transitions) &&
		JSON.stringify(a.markers) === JSON.stringify(b.markers) &&
		JSON.stringify(a.sequenceRegistry) === JSON.stringify(b.sequenceRegistry) &&
		a.inPoint === b.inPoint &&
		a.outPoint === b.outPoint &&
		a.fps === b.fps &&
		a.scrollPosition === b.scrollPosition &&
		a.snapEnabled === b.snapEnabled &&
		a.currentFrame === b.currentFrame &&
		a.masterVolumeDb === b.masterVolumeDb &&
		a.masterMuted === b.masterMuted &&
		JSON.stringify(a.busAudioEq ?? null) === JSON.stringify(b.busAudioEq ?? null)
	);
}
