import type { VideoSource } from '@openpost/video-project';
import {
	indexProjectAsset,
	listProjectAssets,
	readProjectFile,
	recoverVideoStorageBudget,
	writeProjectStream
} from './storage';

export async function openVideoProjectSource(
	projectID: string | undefined,
	source: VideoSource,
	signal?: AbortSignal
): Promise<File> {
	if (source.locator.type === 'local-opfs') {
		const file = await readProjectFile(source.locator.path);
		if (!file) throw new Error(`${source.original_name} is missing from local project storage.`);
		return file;
	}
	if (!projectID) {
		throw new Error(
			`${source.original_name} must be cached locally before it can be edited or exported.`
		);
	}

	const cacheName = sourceCacheName(source);
	const cachePath = `projects/${projectID}/sources/${cacheName}`;
	const indexed = (await listProjectAssets(projectID, source.id)).find(
		(asset) =>
			asset.path === cachePath &&
			asset.kind === 'source' &&
			(!source.content_hash || asset.content_hash === source.content_hash)
	);
	if (indexed) {
		const cached = await readProjectFile(cachePath);
		if (cached && cached.size === source.size_bytes) return cached;
	}

	const budget = await recoverVideoStorageBudget(source.size_bytes, {
		protectedProjectIDs: [projectID],
		signal
	});
	if (!budget.can_continue) {
		throw new Error(
			`There is not enough local space to cache ${source.original_name}. Free local space and try again.`
		);
	}
	// Keep the lossless-export worker free of Svelte runtime stores. Remote
	// sources are normally cached before export; only load the authenticated
	// media helper when this main-thread fallback actually needs the network.
	const { getAuthenticatedMediaByID } = await import('$lib/media-url');
	const response = await fetch(getAuthenticatedMediaByID(source.locator.media_id), { signal });
	if (!response.ok || !response.body) {
		throw new Error(`${source.original_name} could not be read from OpenPost Media.`);
	}
	const result = await writeProjectStream(projectID, 'sources', cacheName, response.body, {
		expectedSize: source.size_bytes,
		expectedSHA256: source.content_hash,
		signal
	});
	const now = new Date().toISOString();
	await indexProjectAsset({
		id: `${projectID}:source-cache:${source.id}`,
		project_id: projectID,
		source_id: source.id,
		path: result.path,
		kind: 'source',
		size_bytes: result.size,
		content_hash: result.sha256,
		created_at: indexed?.created_at ?? now,
		updated_at: now,
		disposable: false
	});
	const cached = await readProjectFile(result.path);
	if (!cached)
		throw new Error(`${source.original_name} finished downloading but could not be opened.`);
	return cached;
}

function sourceCacheName(source: VideoSource): string {
	const identity =
		source.content_hash ??
		(source.locator.type === 'openpost-media' ? source.locator.media_id : source.id);
	const extension = source.original_name.match(/\.([a-z0-9]{1,8})$/iu)?.[1]?.toLowerCase();
	return `${identity.replace(/[^a-z0-9_-]/giu, '-')}${extension ? `.${extension}` : ''}`;
}
