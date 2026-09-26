const LOCAL_MEDIA_PREFIX = 'local_media_';
const objectURLs = new Map<string, string>();
const designMediaIDs = new Map<string, Set<string>>();
const designConsumers = new Map<string, number>();
const designGenerations = new Map<string, number>();

export function isLocalImageEditorMediaID(value: string): boolean {
	return value.startsWith(LOCAL_MEDIA_PREFIX);
}

export function registerLocalImageEditorMedia(
	mediaID: string,
	blob: Blob,
	designID?: string
): string {
	const previous = objectURLs.get(mediaID);
	if (previous) URL.revokeObjectURL(previous);
	const url = URL.createObjectURL(blob);
	objectURLs.set(mediaID, url);
	if (designID) {
		let ids = designMediaIDs.get(designID);
		if (!ids) designMediaIDs.set(designID, (ids = new Set()));
		ids.add(mediaID);
	}
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
	for (const [designID, ids] of designMediaIDs) {
		ids.delete(mediaID);
		if (ids.size === 0) designMediaIDs.delete(designID);
	}
}

export function retainLocalImageEditorMediaForDesign(designID: string): void {
	designConsumers.set(designID, (designConsumers.get(designID) ?? 0) + 1);
}

export function localImageEditorMediaGeneration(designID: string): number {
	return designGenerations.get(designID) ?? 0;
}

export function releaseLocalImageEditorMediaForDesign(designID: string): void {
	const consumers = designConsumers.get(designID) ?? 0;
	if (consumers > 1) {
		designConsumers.set(designID, consumers - 1);
		return;
	}
	designConsumers.delete(designID);
	designGenerations.set(designID, localImageEditorMediaGeneration(designID) + 1);
	releaseUnretainedLocalImageEditorMediaForDesign(designID);
}

export function releaseUnretainedLocalImageEditorMediaForDesign(designID: string): void {
	if (designConsumers.has(designID)) return;
	for (const mediaID of [...(designMediaIDs.get(designID) ?? [])]) {
		releaseLocalImageEditorMedia(mediaID);
	}
}
