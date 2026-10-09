/**
 * Resolve an object URL for playing a media item. Callers must revoke.
 */

import type { MediaMetadata } from './types';
import { resolveMediaBlob } from './resolve-media-blob';

interface MediaUrlEntry {
	controller: AbortController;
	promise: Promise<string>;
	url?: string;
}

const urlCache = new Map<string, MediaUrlEntry>();

export async function getMediaObjectUrl(media: MediaMetadata): Promise<string> {
	const cached = urlCache.get(media.id);
	if (cached) return cached.promise;
	const controller = new AbortController();
	const entry: MediaUrlEntry = {
		controller,
		promise: resolveMediaBlob(media, { signal: controller.signal })
			.then((blob) => {
				// Native file reads cannot abort, so fence their completion before creating a URL.
				controller.signal.throwIfAborted();
				entry.url = URL.createObjectURL(blob);
				return entry.url;
			})
			.catch((error) => {
				if (urlCache.get(media.id) === entry) urlCache.delete(media.id);
				throw error;
			})
	};
	urlCache.set(media.id, entry);
	return entry.promise;
}

export function revokeMediaObjectUrl(mediaId: string): void {
	const entry = urlCache.get(mediaId);
	if (!entry) return;
	urlCache.delete(mediaId);
	entry.controller.abort();
	if (entry.url) URL.revokeObjectURL(entry.url);
}
