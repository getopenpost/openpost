/** Persistent source-fingerprinted cache for embedded text subtitle tracks. */

import type { EmbeddedSubtitleTrack } from '../media/embedded-subtitles';
import type { MediaMetadata } from '../media/types';
import { readJson, writeJsonAtomic } from './fs-primitives';
import { createLogger } from './logger';
import { mediaEmbeddedSubtitlesPath } from './paths';
import { requireWorkspaceRoot } from './root';

const logger = createLogger('WorkspaceFS:EmbeddedSubtitles');

interface EmbeddedSubtitleCacheDocument {
	schemaVersion: 1;
	mediaId: string;
	sourceFileSize: number;
	sourceLastModified?: number;
	contentHash?: string;
	scannedAt: number;
	tracks: EmbeddedSubtitleTrack[];
}

function matchesMedia(document: EmbeddedSubtitleCacheDocument, media: MediaMetadata): boolean {
	if (document.mediaId !== media.id || document.sourceFileSize !== media.fileSize) return false;
	if (document.contentHash && media.contentHash) return document.contentHash === media.contentHash;
	return (
		document.sourceLastModified === undefined ||
		media.fileLastModified === undefined ||
		document.sourceLastModified === media.fileLastModified
	);
}

export async function getEmbeddedSubtitleCache(
	media: MediaMetadata
): Promise<EmbeddedSubtitleCacheDocument | null> {
	try {
		const document = await readJson<EmbeddedSubtitleCacheDocument>(
			requireWorkspaceRoot(),
			mediaEmbeddedSubtitlesPath(media.id)
		);
		return document?.schemaVersion === 1 && matchesMedia(document, media) ? document : null;
	} catch (error) {
		logger.warn(`getEmbeddedSubtitleCache(${media.id}) failed`, error);
		return null;
	}
}

export async function saveEmbeddedSubtitleCache(
	media: MediaMetadata,
	tracks: readonly EmbeddedSubtitleTrack[]
): Promise<number> {
	const scannedAt = Date.now();
	await writeJsonAtomic(requireWorkspaceRoot(), mediaEmbeddedSubtitlesPath(media.id), {
		schemaVersion: 1,
		mediaId: media.id,
		sourceFileSize: media.fileSize,
		sourceLastModified: media.fileLastModified,
		contentHash: media.contentHash,
		scannedAt,
		tracks: [...tracks]
	} satisfies EmbeddedSubtitleCacheDocument);
	return scannedAt;
}
