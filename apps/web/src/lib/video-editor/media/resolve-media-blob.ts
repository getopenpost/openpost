import { readBlob } from '@openpost/editor-shared/workspace';
import {
	mediaSourceByFileName,
	sanitizeWorkspaceFileName
} from '@openpost/editor-shared/workspace';
import { requireWorkspaceRoot } from '@openpost/editor-shared/workspace';
import type { MediaMetadata } from '@openpost/editor-shared/media';

/** Resolve a linked or collected source without loading media-import UI code. */
export async function resolveMediaBlob(
	media: MediaMetadata,
	options: { signal?: AbortSignal } = {}
): Promise<Blob> {
	options.signal?.throwIfAborted();
	if (media.storageType === 'cloud' && media.remoteUrl) {
		try {
			const response = await fetch(media.remoteUrl, {
				credentials: 'include',
				signal: options.signal
			});
			if (!response.ok) throw new Error(`Could not load ${media.fileName} (${response.status})`);
			return await response.blob();
		} catch (error) {
			options.signal?.throwIfAborted();
			const cached =
				media.offlineUrl && typeof caches !== 'undefined'
					? await caches.match(media.offlineUrl)
					: undefined;
			if (cached) return cached.blob();
			throw error;
		}
	}
	if (media.storageType === 'handle' && media.fileHandle) {
		try {
			return await media.fileHandle.getFile();
		} catch {
			// Fall through to the mirrored workspace copy below.
		}
	}
	const root = requireWorkspaceRoot();
	const fileName = sanitizeWorkspaceFileName(media.fileName);
	const blob = await readBlob(root, mediaSourceByFileName(media.id, fileName));
	if (!blob) throw new Error(`Source bytes missing for ${media.fileName}`);
	return blob;
}
