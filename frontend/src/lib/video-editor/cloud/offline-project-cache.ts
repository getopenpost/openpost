import { browser } from '$app/environment';
import type { MediaMetadata } from '../media/types';
import type { CloudVideoProject, CloudVideoProjectRepository } from './project-repository';

const CACHE_NAME = 'openpost-cloud-video-projects-v1';

type OfflineProjectManifest<TDocument extends object> = {
	project: CloudVideoProject<TDocument>;
	media: MediaMetadata[];
	pinned: boolean;
};

function cacheURL(workspaceId: string, projectId: string, item: string): string {
	const url = new URL('/__openpost/cloud-video-projects/offline', location.origin);
	url.searchParams.set('workspace', workspaceId);
	url.searchParams.set('project', projectId);
	url.searchParams.set('item', item);
	return url.toString();
}

function manifestURL(workspaceId: string, projectId: string): string {
	return cacheURL(workspaceId, projectId, 'manifest');
}

export function offlineMediaURL(workspaceId: string, projectId: string, mediaId: string): string {
	return cacheURL(workspaceId, projectId, `media:${mediaId}`);
}

export async function cacheCloudProjectDocument<TDocument extends object>(
	project: CloudVideoProject<TDocument>,
	media: MediaMetadata[] = [],
	pinned = false
): Promise<void> {
	if (!browser || !('caches' in window)) return;
	const cache = await caches.open(CACHE_NAME);
	const existing = await readOfflineCloudProject<TDocument>(project.workspaceId, project.id);
	const manifest: OfflineProjectManifest<TDocument> = {
		project,
		media: media.length > 0 ? media : (existing?.media ?? []),
		pinned: pinned || existing?.pinned === true
	};
	await cache.put(
		manifestURL(project.workspaceId, project.id),
		new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
	);
}

export async function readOfflineCloudProject<TDocument extends object>(
	workspaceId: string,
	projectId: string
): Promise<OfflineProjectManifest<TDocument> | null> {
	if (!browser || !('caches' in window)) return null;
	const cache = await caches.open(CACHE_NAME);
	const response = await cache.match(manifestURL(workspaceId, projectId));
	if (!response) return null;
	try {
		return (await response.json()) as OfflineProjectManifest<TDocument>;
	} catch {
		return null;
	}
}

export async function isCloudProjectAvailableOffline(
	workspaceId: string,
	projectId: string
): Promise<boolean> {
	const manifest = await readOfflineCloudProject(workspaceId, projectId);
	if (!manifest?.pinned) return false;
	const cache = await caches.open(CACHE_NAME);
	const availability = await Promise.all(
		manifest.media.map((media) => cache.match(offlineMediaURL(workspaceId, projectId, media.id)))
	);
	return availability.every(Boolean);
}

export async function keepCloudProjectAvailableOffline<TDocument extends object>(
	repository: CloudVideoProjectRepository<TDocument>,
	projectId: string
): Promise<void> {
	if (!browser || !('caches' in window)) throw new Error('Offline storage is not available');
	const [project, media] = await Promise.all([
		repository.get(projectId),
		repository.listMedia(projectId)
	]);
	const cache = await caches.open(CACHE_NAME);
	for (const item of media) {
		if (!item.remoteUrl) throw new Error(`Source is unavailable: ${item.fileName}`);
		const response = await fetch(item.remoteUrl, { credentials: 'include' });
		if (!response.ok) throw new Error(`Could not save ${item.fileName} (${response.status})`);
		await cache.put(offlineMediaURL(repository.workspaceId, projectId, item.id), response);
	}
	await cacheCloudProjectDocument(project, media, true);
}

export async function removeCloudProjectOfflineCopy(
	workspaceId: string,
	projectId: string
): Promise<void> {
	if (!browser || !('caches' in window)) return;
	const manifest = await readOfflineCloudProject(workspaceId, projectId);
	const cache = await caches.open(CACHE_NAME);
	await Promise.all([
		...(manifest?.media ?? []).map((media) =>
			cache.delete(offlineMediaURL(workspaceId, projectId, media.id))
		),
		cache.delete(manifestURL(workspaceId, projectId))
	]);
}

export function purgeCloudVideoProjectOfflineData(): void {
	if (!browser || !('caches' in window)) return;
	void caches.delete(CACHE_NAME);
}
