import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import {
	commitFreezeFrame,
	freezeFrameBlockReason,
	type FreezeFrameBlockReason
} from '../timeline/actions/freeze-frame.svelte';
import { importGeneratedImage, rollbackNewGeneratedMedia } from './import.svelte';
import { mediaPool } from './pool.svelte';
import { extractFreezeFrame } from './freeze-frame';

export type InsertFreezeFrameResult =
	| { ok: true; itemId: string }
	| { ok: false; reason: FreezeFrameBlockReason | 'media-missing' };

export async function insertFreezeFrame(options: {
	projectId: string;
	itemId: string;
	playheadFrame: number;
}): Promise<InsertFreezeFrameResult> {
	const item = timelineStore.itemById.get(options.itemId);
	const blocked = freezeFrameBlockReason(item, options.playheadFrame);
	if (blocked) return { ok: false, reason: blocked };
	if (!item?.mediaId) return { ok: false, reason: 'media-missing' };
	const media = mediaPool.get(item.mediaId);
	if (!media) return { ok: false, reason: 'media-missing' };

	const source = snapshotTimelineState(item);
	const timelineFps = timelineStore.fps;
	const extracted = await extractFreezeFrame(media, source, options.playheadFrame, timelineFps);
	const seconds = Math.round(extracted.sourceSeconds * 100) / 100;
	const file = new File(
		[extracted.blob],
		`freeze-frame-${source.label || 'video'}-${seconds}s.png`,
		{ type: 'image/png', lastModified: Date.now() }
	);
	const generated = await importGeneratedImage(file, {
		projectId: options.projectId,
		width: extracted.width,
		height: extracted.height,
		tags: ['freeze-frame']
	});

	const freezeFrameId = commitFreezeFrame({
		source,
		playheadFrame: options.playheadFrame,
		timelineFps,
		durationInFrames: timelineFps * 2,
		media: generated
	});
	if (freezeFrameId) return { ok: true, itemId: freezeFrameId };

	await rollbackNewGeneratedMedia(options.projectId, generated.id);
	return { ok: false, reason: 'source-changed' };
}
