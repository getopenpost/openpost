const LOCAL_MEDIA_PREFIX = 'local_media_';
const objectURLs = new Map<string, string>();

export function isLocalImageEditorMediaID(value: string): boolean {
	return value.startsWith(LOCAL_MEDIA_PREFIX);
}

export function registerLocalImageEditorMedia(mediaID: string, blob: Blob): string {
	const previous = objectURLs.get(mediaID);
	if (previous) URL.revokeObjectURL(previous);
	const url = URL.createObjectURL(blob);
	objectURLs.set(mediaID, url);
	return url;
}

export function localImageEditorMediaURL(mediaID: string): string | undefined {
	return objectURLs.get(mediaID);
}

export function localImageEditorMediaURLFromPath(path: string): string | undefined {
	const match = path.match(/(?:^|\/media\/)(local_media_[^/?]+)(?:\/thumb\/[^/?]+)?(?:$|[?#])/);
	return match ? localImageEditorMediaURL(match[1]) : undefined;
}

export function releaseLocalImageEditorMedia(mediaID: string): void {
	const url = objectURLs.get(mediaID);
	if (!url) return;
	URL.revokeObjectURL(url);
	objectURLs.delete(mediaID);
}
