/**
 * Resolve an object URL for playing a media item. Callers must revoke.
 */

import type { MediaMetadata } from './types';
import { resolveMediaBlob } from './import.svelte';

const urlCache = new Map<string, string>();

export async function getMediaObjectUrl(media: MediaMetadata): Promise<string> {
	const cached = urlCache.get(media.id);
	if (cached) return cached;
	const blob = await resolveMediaBlob(media);
	const url = URL.createObjectURL(blob);
	urlCache.set(media.id, url);
	return url;
}

export function revokeMediaObjectUrl(mediaId: string): void {
	const url = urlCache.get(mediaId);
	if (url) {
		URL.revokeObjectURL(url);
		urlCache.delete(mediaId);
	}
}
