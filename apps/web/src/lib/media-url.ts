import { localImageEditorMediaURLFromPath } from '$lib/image-editor/local-media-url';

function normalizeMediaPath(path: string): string {
	if (!path) return path;
	if (path.startsWith('http://') || path.startsWith('https://')) {
		return path;
	}
	return path.startsWith('/') ? path : `/${path}`;
}

export function getAuthenticatedMediaURL(path: string): string {
	const localURL = localImageEditorMediaURLFromPath(path);
	if (localURL) return localURL;
	return normalizeMediaPath(path);
}

export function getAuthenticatedMediaByID(mediaID: string): string {
	return getAuthenticatedMediaURL(`/media/${mediaID}`);
}
