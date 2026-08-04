import type { VideoSource } from '@openpost/video-project';
import { listProjectAssets, readProjectFile } from './storage';
import { openVideoProjectSource } from './source-access';

const urls = new Map<string, string>();

export async function localVideoSourceURL(
	source: VideoSource,
	projectID?: string,
	preferProxy = false
): Promise<string> {
	if (source.locator.type !== 'local-opfs') {
		return `/media/${encodeURIComponent(source.locator.media_id)}`;
	}
	let path = source.locator.path;
	if (preferProxy && projectID && source.kind !== 'image' && source.kind !== 'audio') {
		const proxy = (await listProjectAssets(projectID, source.id)).find(
			(asset) => asset.kind === 'proxy'
		);
		if (proxy && (await readProjectFile(proxy.path))) path = proxy.path;
	}
	const existing = urls.get(path);
	if (existing) return existing;
	const file = await readProjectFile(path);
	if (!file) throw new Error(`${source.original_name} is missing from local project storage.`);
	const url = URL.createObjectURL(file);
	urls.set(path, url);
	return url;
}

export function releaseVideoSourceURLs(): void {
	for (const url of urls.values()) URL.revokeObjectURL(url);
	urls.clear();
}

export async function openVideoProjectPreviewSource(
	projectID: string | undefined,
	source: VideoSource,
	signal?: AbortSignal
): Promise<{ file: File; using_proxy: boolean }> {
	if (projectID && source.kind !== 'image' && source.kind !== 'audio') {
		const proxy = (await listProjectAssets(projectID, source.id)).find(
			(asset) => asset.kind === 'proxy'
		);
		if (proxy) {
			const file = await readProjectFile(proxy.path);
			if (file) return { file, using_proxy: true };
		}
	}
	return {
		file: await openVideoProjectSource(projectID, source, signal),
		using_proxy: false
	};
}
