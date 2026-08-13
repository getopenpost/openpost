import { client, type SocialAccount } from '$lib/api/client';
import type { components } from '$lib/api/types';

type Publication = components['schemas']['PublicationResponse'];
type CapabilityCatalog = components['schemas']['CapabilitiesOutputBody'];
type SocialSet = components['schemas']['SocialSetResponse'];

interface CacheEntry<T> {
	value?: T;
	expiresAt: number;
	inFlight?: Promise<T>;
}

const publicationCache = new Map<string, CacheEntry<Publication>>();
const accountCache = new Map<string, CacheEntry<SocialAccount[]>>();
const socialSetCache = new Map<string, CacheEntry<SocialSet[]>>();
const capabilityCache: CacheEntry<CapabilityCatalog> = { expiresAt: 0 };

const publicationTTL = 30_000;
const workspaceDataTTL = 30_000;
const capabilityTTL = 5 * 60_000;

async function cachedQuery<T>(
	entry: CacheEntry<T>,
	ttl: number,
	loader: () => Promise<T>,
	force = false
): Promise<T> {
	const now = Date.now();
	if (!force && entry.value !== undefined && entry.expiresAt > now) return entry.value;
	if (!force && entry.inFlight) return entry.inFlight;

	const request = loader()
		.then((value) => {
			entry.value = value;
			entry.expiresAt = Date.now() + ttl;
			return value;
		})
		.finally(() => {
			if (entry.inFlight === request) entry.inFlight = undefined;
		});
	entry.inFlight = request;
	return request;
}

function mapEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> {
	let entry = cache.get(key);
	if (!entry) {
		entry = { expiresAt: 0 };
		cache.set(key, entry);
	}
	return entry;
}

function problemDetail(error: { detail?: string } | undefined): string {
	return error?.detail?.trim() ?? '';
}

export function loadPublicationDetail(id: string, force = false): Promise<Publication> {
	return cachedQuery(
		mapEntry(publicationCache, id),
		publicationTTL,
		async () => {
			const { data, error } = await client.GET('/publications/{id}', {
				params: { path: { id } }
			});
			if (error || !data) throw new Error(problemDetail(error));
			return data;
		},
		force
	);
}

export function prefetchDraftComposerData(publicationId: string, workspaceId: string): void {
	const requests: Promise<unknown>[] = [
		loadPublicationDetail(publicationId),
		loadCapabilityCatalog()
	];
	if (workspaceId) {
		requests.push(loadWorkspaceAccounts(workspaceId), loadWorkspaceSocialSets(workspaceId));
	}
	void Promise.allSettled(requests);
}

export function loadCapabilityCatalog(force = false): Promise<CapabilityCatalog> {
	return cachedQuery(
		capabilityCache,
		capabilityTTL,
		async () => {
			const { data, error } = await client.GET('/capabilities', {});
			if (error || !data) throw new Error(problemDetail(error));
			return data;
		},
		force
	);
}

export function loadWorkspaceAccounts(
	workspaceId: string,
	force = false
): Promise<SocialAccount[]> {
	return cachedQuery(
		mapEntry(accountCache, workspaceId),
		workspaceDataTTL,
		async () => {
			const { data, error } = await client.GET('/accounts', {
				params: { query: { workspace_id: workspaceId } }
			});
			if (error) throw new Error(problemDetail(error));
			return data ?? [];
		},
		force
	);
}

export function loadWorkspaceSocialSets(workspaceId: string, force = false): Promise<SocialSet[]> {
	return cachedQuery(
		mapEntry(socialSetCache, workspaceId),
		workspaceDataTTL,
		async () => {
			const { data, error } = await client.GET('/social-sets', {
				params: { query: { workspace_id: workspaceId } }
			});
			if (error) throw new Error(problemDetail(error));
			return data ?? [];
		},
		force
	);
}

export function invalidateWorkspaceSocialSets(workspaceId: string): void {
	socialSetCache.delete(workspaceId);
}
