import { importCopiedFile, rollbackNewGeneratedMedia } from './import.svelte';
import { mediaPool } from './pool.svelte';
import type { MediaAttribution, MediaMetadata } from './types';
import { insertMediaAtFrame } from '../timeline/actions/insert-media';

export interface CommitImportedAssetOptions {
	projectId: string;
	attribution: MediaAttribution;
	tags: string[];
	insertAtFrame: number;
	label?: string;
}

/** Save a trusted external asset and insert it without leaving partial media on failure. */
export async function commitImportedAsset(
	file: File,
	options: CommitImportedAssetOptions
): Promise<{ media: MediaMetadata; itemId: string }> {
	const existing = mediaPool.mediaList.find(
		(media) =>
			media.attribution?.provider === options.attribution.provider &&
			media.attribution.sourceId === options.attribution.sourceId
	);
	if (existing) {
		return {
			media: existing,
			itemId: insertMediaAtFrame(existing, options.insertAtFrame, {
				label: options.label
			})
		};
	}
	const mediaId = await importCopiedFile(file, {
		projectId: options.projectId,
		attribution: options.attribution,
		tags: options.tags
	});
	try {
		const media = mediaPool.get(mediaId);
		if (!media) throw new Error('The imported asset did not reach the media pool.');
		const itemId = insertMediaAtFrame(media, options.insertAtFrame, {
			label: options.label
		});
		return { media, itemId };
	} catch (error) {
		await rollbackNewGeneratedMedia(options.projectId, mediaId);
		throw error;
	}
}
