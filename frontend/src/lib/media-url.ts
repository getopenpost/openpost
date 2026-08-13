import { getToken } from '$lib/api/client';
import { getMediaBase } from '$lib/stores/instance.svelte';
import { localImageEditorMediaURLFromPath } from '$lib/image-editor/local-media-url';

function normalizeMediaPath(path: string): string {
	if (!path) return path;
	if (path.startsWith('http://') || path.startsWith('https://')) {
		return path;
	}
	if (path.startsWith('/')) {
		return `${getMediaBase()}${path}`;
	}
	return `${getMediaBase()}/${path}`;
}

export function getAuthenticatedMediaURL(path: string): string {
	const localURL = localImageEditorMediaURLFromPath(path);
	if (localURL) return localURL;
	const normalized = normalizeMediaPath(path);
	const token = getToken();
	if (!normalized || !token) {
		return normalized;
	}

	const separator = normalized.includes('?') ? '&' : '?';
	return `${normalized}${separator}token=${encodeURIComponent(token)}`;
}

export function getAuthenticatedMediaByID(mediaID: string): string {
	return getAuthenticatedMediaURL(`/media/${mediaID}`);
}
