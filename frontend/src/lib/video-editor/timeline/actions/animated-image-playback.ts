import type { TimelineItem } from '../../project/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../utils/track-groups';

const MIN_ANIMATED_IMAGE_SPEED = 0.1;
const MAX_ANIMATED_IMAGE_SPEED = 10;

export interface AnimatedImagePlaybackResult {
	changed: number;
	locked: number;
	noop: number;
}

function imageTargets(itemIds: readonly string[]): TimelineItem[] {
	return [...new Set(itemIds)]
		.map((itemId) => timelineStore.itemById.get(itemId))
		.filter((item): item is TimelineItem => item?.type === 'image');
}

function lockedTrackIds(): Set<string> {
	return new Set(
		effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.locked)
			.map((track) => track.id)
	);
}

/** Change the animation clock without changing the GIF/WebP clip's timeline duration. */
export function setAnimatedImageSpeedLive(
	itemIds: readonly string[],
	speed: number
): AnimatedImagePlaybackResult {
	if (!Number.isFinite(speed)) return { changed: 0, locked: 0, noop: 0 };
	const clamped = Math.max(
		MIN_ANIMATED_IMAGE_SPEED,
		Math.min(MAX_ANIMATED_IMAGE_SPEED, Math.round(speed * 100) / 100)
	);
	const targets = imageTargets(itemIds);
	const lockedIds = lockedTrackIds();
	const locked = targets.filter((item) => lockedIds.has(item.trackId)).length;
	const noop = targets.filter((item) => Math.abs((item.speed ?? 1) - clamped) < 0.0001).length;
	if (targets.length === 0 || locked > 0) return { changed: 0, locked, noop };
	const updates = targets
		.filter((item) => Math.abs((item.speed ?? 1) - clamped) >= 0.0001)
		.map((item) => ({ id: item.id, patch: { speed: clamped } }));
	if (updates.length > 0) timelineStore._updateItems(updates);
	return { changed: updates.length, locked: 0, noop };
}

export function setAnimatedImageSpeed(
	itemIds: readonly string[],
	speed: number
): AnimatedImagePlaybackResult {
	return execute('SET_ANIMATED_IMAGE_SPEED', () => setAnimatedImageSpeedLive(itemIds, speed));
}

export function setAnimatedImagesReversed(
	itemIds: readonly string[],
	isReversed: boolean
): AnimatedImagePlaybackResult {
	const targets = imageTargets(itemIds);
	const lockedIds = lockedTrackIds();
	const locked = targets.filter((item) => lockedIds.has(item.trackId)).length;
	const noop = targets.filter((item) => (item.isReversed === true) === isReversed).length;
	if (targets.length === 0 || locked > 0) return { changed: 0, locked, noop };
	const updates = targets
		.filter((item) => (item.isReversed === true) !== isReversed)
		.map((item) => ({ id: item.id, patch: { isReversed } }));
	if (updates.length === 0) return { changed: 0, locked: 0, noop };
	execute('SET_ANIMATED_IMAGES_REVERSED', () => timelineStore._updateItems(updates));
	return { changed: updates.length, locked: 0, noop };
}
