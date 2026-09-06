/**
 * Track sync-lock semantics: a sync-locked track mirrors ripple edits made on
 * edited tracks so multi-track content (video + its audio) stays aligned.
 *
 * Ported from FreeCut (MIT) — utils/track-sync-lock.ts.
 */

import type { TimelineTrack } from '../../project/types';

type SyncLockTrackLike = Pick<TimelineTrack, 'locked' | 'syncLock'>;

export function isTrackSyncLockEnabled(track: SyncLockTrackLike | null | undefined): boolean {
	if (!track) return true;
	return !track.locked && track.syncLock !== false;
}

export function isTrackSyncLockActive(
	track: Pick<TimelineTrack, 'syncLock'> | null | undefined
): boolean {
	return track?.syncLock !== false;
}
