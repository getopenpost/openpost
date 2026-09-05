import { readBlob } from '../workspace-fs/fs-primitives';
import { mediaSourceByFileName, sanitizeWorkspaceFileName } from '../workspace-fs/paths';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import type { MediaMetadata } from './types';

/** Resolve a linked or collected source without loading media-import UI code. */
export async function resolveMediaBlob(media: MediaMetadata): Promise<Blob> {
	if (media.storageType === 'cloud' && media.remoteUrl) {
		try {
			const response = await fetch(media.remoteUrl, { credentials: 'include' });
			if (!response.ok) throw new Error(`Could not load ${media.fileName} (${response.status})`);
			return response.blob();
		} catch (error) {
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
