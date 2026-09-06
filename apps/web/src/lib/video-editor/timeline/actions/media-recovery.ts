import type { TimelineItem } from '../../project/types';
import { mediaCanRecoverItemType } from '../../media/media-recovery';
import type { MediaMetadata } from '../../media/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { isTrackEffectivelyLocked } from '../utils/track-groups';

export type OrphanRelinkResult =
	| { ok: true; itemIds: string[] }
	| { ok: false; reason: 'not-found' | 'incompatible' | 'locked' };

function itemAcceptsMedia(item: TimelineItem, media: MediaMetadata): boolean {
	if (
		item.type !== 'video' &&
		item.type !== 'audio' &&
		item.type !== 'image' &&
		item.type !== 'lottie'
	) {
		return false;
	}
	return mediaCanRecoverItemType(item.type, media);
}

function replacementPatch(item: TimelineItem, media: MediaMetadata): Partial<TimelineItem> {
	const patch: Partial<TimelineItem> = {
		mediaId: media.id,
		label: media.fileName
	};

	if (item.type === 'video' || item.type === 'audio') {
		const sourceFps = media.fps > 0 ? media.fps : timelineStore.fps;
		const sourceDuration = Math.max(1, Math.round(media.duration * sourceFps));
		const sourceStart = Math.min(Math.max(0, item.sourceStart ?? 0), sourceDuration - 1);
		patch.sourceFps = sourceFps;
		patch.sourceDuration = sourceDuration;
		patch.sourceStart = sourceStart;
		patch.sourceEnd = Math.min(
			sourceDuration,
			Math.max(sourceStart + 1, item.sourceEnd ?? sourceDuration)
		);
	}

	if (item.type !== 'audio') {
		patch.sourceWidth = media.width || item.sourceWidth;
		patch.sourceHeight = media.height || item.sourceHeight;
	}

	if (item.type === 'lottie') {
		patch.lottieTotalFrames = media.lottieTotalFrames ?? 1;
		patch.lottieFrameRate = media.fps || timelineStore.fps;
		patch.lottieMarkers = media.lottieMarkers;
	}

	return patch;
}

export function relinkOrphanedClip(itemId: string, replacement: MediaMetadata): OrphanRelinkResult {
	return relinkOrphanedClips([{ itemId, replacement }]);
}

export function relinkOrphanedClips(
	requests: readonly { itemId: string; replacement: MediaMetadata }[]
): OrphanRelinkResult {
	const updates = new Map<string, { item: TimelineItem; replacement: MediaMetadata }>();
	for (const request of requests) {
		const anchor = timelineStore.itemById.get(request.itemId);
		if (!anchor?.mediaId) return { ok: false, reason: 'not-found' };
		if (!itemAcceptsMedia(anchor, request.replacement)) {
			return { ok: false, reason: 'incompatible' };
		}
		const targets = timelineStore.items.filter(
			(item) => item.mediaId === anchor.mediaId && itemAcceptsMedia(item, request.replacement)
		);
		if (targets.some((item) => isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))) {
			return { ok: false, reason: 'locked' };
		}
		for (const item of targets) updates.set(item.id, { item, replacement: request.replacement });
	}
	if (updates.size === 0) return { ok: false, reason: 'not-found' };

	return execute('RELINK_ORPHANED_MEDIA', () => {
		timelineStore._updateItems(
			[...updates.values()].map(({ item, replacement }) => ({
				id: item.id,
				patch: replacementPatch(item, replacement)
			}))
		);
		return { ok: true, itemIds: [...updates.keys()] };
	});
}
