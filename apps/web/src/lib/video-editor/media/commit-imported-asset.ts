import { importCopiedFile, rollbackNewGeneratedMedia } from './import.svelte';
import { mediaPool } from './pool.svelte';
import type { MediaAttribution, MediaMetadata, ProjectAssetImporter } from './types';
import { insertMediaAtFrame } from '../timeline/actions/insert-media';

export interface CommitImportedAssetOptions {
	projectId: string;
	attribution: MediaAttribution;
	tags: string[];
	insertAtFrame: number;
	label?: string;
	exactTrackId?: string;
	preferredTrackId?: string;
	importAsset?: ProjectAssetImporter;
}

interface CommitImportedAssetDependencies {
	insertMedia: typeof insertMediaAtFrame;
}

const defaultDependencies: CommitImportedAssetDependencies = {
	insertMedia: insertMediaAtFrame
};

/** Save a trusted external asset and insert it without leaving partial media on failure. */
export async function commitImportedAsset(
	file: File,
	options: CommitImportedAssetOptions,
	dependencies: CommitImportedAssetDependencies = defaultDependencies
): Promise<{ media: MediaMetadata; itemId: string }> {
	const existing = mediaPool.mediaList.find(
		(media) =>
			media.attribution?.provider === options.attribution.provider &&
			media.attribution.sourceId === options.attribution.sourceId
	);
	if (existing) {
		return {
			media: existing,
			itemId: dependencies.insertMedia(existing, options.insertAtFrame, {
				label: options.label,
				exactTrackId: options.exactTrackId,
				preferredTrackId: options.preferredTrackId
			})
		};
	}
	const imported = options.importAsset
		? await options.importAsset(file, {
				projectId: options.projectId,
				attribution: options.attribution,
				tags: options.tags
			})
		: null;
	if (options.importAsset && !imported) throw new Error('The asset import was cancelled.');
	const mediaId = imported
		? imported.id
		: await importCopiedFile(file, {
				projectId: options.projectId,
				attribution: options.attribution,
				tags: options.tags
			});
	try {
		const media = mediaPool.get(mediaId);
		if (!media) throw new Error('The imported asset did not reach the media pool.');
		const itemId = dependencies.insertMedia(media, options.insertAtFrame, {
			label: options.label,
			exactTrackId: options.exactTrackId,
			preferredTrackId: options.preferredTrackId
		});
		return { media, itemId };
	} catch (error) {
		if (imported) mediaPool.remove(mediaId);
		else await rollbackNewGeneratedMedia(options.projectId, mediaId);
		throw error;
	}
}
