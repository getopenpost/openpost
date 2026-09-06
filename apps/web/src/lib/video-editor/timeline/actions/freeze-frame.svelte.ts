import type { MediaMetadata } from '../../media/types';
import type { TimelineItem } from '../../project/types';
import { resolveAnimatedItemAt } from '../animated-properties';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { snapshotTimelineState } from '../utils/state-snapshot.svelte';
import { isTrackEffectivelyLocked } from '../utils/track-groups';
import { pruneInvalidTransitions } from './transitions.svelte';
import { transitionsStore } from './transitions-store.svelte';

export type FreezeFrameBlockReason =
	| 'not-video'
	| 'locked-track'
	| 'playhead-outside'
	| 'transition-overlap'
	| 'source-changed';

export interface FreezeFrameCommitInput {
	source: TimelineItem;
	playheadFrame: number;
	timelineFps: number;
	durationInFrames: number;
	media: Pick<MediaMetadata, 'id' | 'fileName' | 'width' | 'height'>;
}

function sameTimelineItem(left: TimelineItem, right: TimelineItem): boolean {
	return (
		JSON.stringify(snapshotTimelineState(left)) === JSON.stringify(snapshotTimelineState(right))
	);
}

export function freezeFrameBlockReason(
	item: TimelineItem | undefined,
	playheadFrame: number
): FreezeFrameBlockReason | null {
	if (!item || item.type !== 'video') return 'not-video';
	if (isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) {
		return 'locked-track';
	}
	if (playheadFrame <= item.from || playheadFrame >= item.from + item.durationInFrames) {
		return 'playhead-outside';
	}
	if (transitionsStore.at(item, playheadFrame - item.from)) return 'transition-overlap';
	return null;
}

/** Commit the split, still insertion, downstream shift, and transition repair as one undo step. */
export function commitFreezeFrame(input: FreezeFrameCommitInput): string | null {
	const current = timelineStore.itemById.get(input.source.id);
	if (timelineStore.fps !== input.timelineFps) return null;
	if (!current || !sameTimelineItem(current, input.source)) return null;
	if (freezeFrameBlockReason(current, input.playheadFrame)) return null;

	const durationInFrames = Math.max(1, Math.round(input.durationInFrames));
	const resolved = resolveAnimatedItemAt(input.source, input.playheadFrame);
	return execute('INSERT_FREEZE_FRAME', () => {
		const source = timelineStore.itemById.get(input.source.id);
		if (timelineStore.fps !== input.timelineFps) return null;
		if (!source || !sameTimelineItem(source, input.source)) return null;
		if (freezeFrameBlockReason(source, input.playheadFrame)) return null;

		const split = timelineStore._splitItem(source.id, input.playheadFrame);
		if (!split) return null;

		const freezeFrameId = crypto.randomUUID();
		const downstream = timelineStore.items
			.filter(
				(item) =>
					item.trackId === source.trackId &&
					item.id !== split.leftItem.id &&
					item.from >= input.playheadFrame
			)
			.map((item) => ({ id: item.id, from: item.from + durationInFrames }));
		timelineStore._moveItems(downstream);

		transitionsStore.setAll(
			transitionsStore.list.map((transition) =>
				transition.fromItemId === source.id
					? { ...transition, fromItemId: split.rightItem.id }
					: transition
			)
		);

		const freezeFrame: TimelineItem = {
			id: freezeFrameId,
			trackId: source.trackId,
			from: input.playheadFrame,
			durationInFrames,
			label: input.media.fileName,
			type: 'image',
			mediaId: input.media.id,
			sourceWidth: input.media.width,
			sourceHeight: input.media.height,
			transform: resolved.transform ? snapshotTimelineState(resolved.transform) : undefined,
			crop: resolved.crop ? snapshotTimelineState(resolved.crop) : undefined,
			cornerPin: resolved.cornerPin ? snapshotTimelineState(resolved.cornerPin) : undefined,
			effects: resolved.effects ? snapshotTimelineState(resolved.effects) : undefined,
			blendMode: resolved.blendMode
		};
		timelineStore._addItem(freezeFrame);
		pruneInvalidTransitions();
		return freezeFrameId;
	});
}
