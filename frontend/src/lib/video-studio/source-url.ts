import type { VideoSource } from '@openpost/video-project';
import { readProjectFile } from './storage';

const urls = new Map<string, string>();

export async function localVideoSourceURL(source: VideoSource): Promise<string> {
	if (source.locator.type !== 'local-opfs') {
		return `/media/${encodeURIComponent(source.locator.media_id)}`;
	}
	const existing = urls.get(source.locator.path);
	if (existing) return existing;
	const file = await readProjectFile(source.locator.path);
	if (!file) throw new Error(`${source.original_name} is missing from local project storage.`);
	const url = URL.createObjectURL(file);
	urls.set(source.locator.path, url);
	return url;
}

export function releaseVideoSourceURLs(): void {
	for (const url of urls.values()) URL.revokeObjectURL(url);
	urls.clear();
}
