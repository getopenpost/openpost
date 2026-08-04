import type { VideoProjectDocumentV1 } from '@openpost/video-project';
import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';

export type VideoEditorConfig = components['schemas']['VideoEditorConfigOutputBody'];
export type CloudVideoProjectSummary = components['schemas']['VideoProjectSummary'];
export type CloudVideoProjectResponse = components['schemas']['VideoProjectResponse'];
export type CloudVideoProjectRevision = components['schemas']['VideoProjectRevisionSummary'];
export type StockProvider = components['schemas']['StockProviderResponse'];
export type StockSearchPage = components['schemas']['SearchPage'];
export type StockAsset = components['schemas']['Asset'];
export type ResolvedStockAsset = components['schemas']['ResolvedAsset'];
export type VideoEditorSyncPlan = components['schemas']['PlanVideoEditorSyncOutputBody'];

export async function loadVideoEditorConfig(): Promise<VideoEditorConfig> {
	const { data, error } = await client.GET('/video-editor/config');
	if (error || !data)
		throw new Error(error?.detail ?? 'OpenPost Video Editor configuration could not load.');
	return data;
}

export async function listCloudVideoProjects(
	workspaceID: string,
	search = ''
): Promise<{ projects: CloudVideoProjectSummary[]; total: number; canEdit: boolean }> {
	const { data, error } = await client.GET('/video-editor/projects', {
		params: { query: { workspace_id: workspaceID, search, limit: 50, offset: 0 } }
	});
	if (error || !data)
		throw new Error(error?.detail ?? 'Cloud OpenPost Video Editor projects could not load.');
	return {
		projects: data.projects ?? [],
		total: data.total,
		canEdit: data.can_edit
	};
}

export async function createCloudVideoProject(
	workspaceID: string,
	document: VideoProjectDocumentV1,
	clientRequestID = crypto.randomUUID()
): Promise<CloudVideoProjectResponse> {
	const { data, error } = await client.POST('/video-editor/projects', {
		body: {
			workspace_id: workspaceID,
			client_request_id: clientRequestID,
			document: document as unknown as components['schemas']['Document']
		}
	});
	if (error || !data)
		throw new Error(error?.detail ?? 'The project could not be saved to OpenPost.');
	return data;
}

export async function getCloudVideoProject(projectID: string): Promise<CloudVideoProjectResponse> {
	const { data, error } = await client.GET('/video-editor/projects/{id}', {
		params: { path: { id: projectID } }
	});
	if (error || !data) throw new Error(error?.detail ?? 'The cloud project could not be opened.');
	return data;
}

export async function updateCloudVideoProject(
	projectID: string,
	expectedRevision: number,
	document: VideoProjectDocumentV1,
	coverPreviewMediaID = ''
): Promise<CloudVideoProjectResponse> {
	const { data, error, response } = await client.PATCH('/video-editor/projects/{id}', {
		params: { path: { id: projectID } },
		body: {
			expected_revision: expectedRevision,
			cover_preview_media_id: coverPreviewMediaID,
			document: document as unknown as components['schemas']['Document']
		}
	});
	if (error || !data) {
		const detail = error?.detail ?? 'The cloud project could not be updated.';
		if (response.status === 409) throw new VideoProjectRevisionConflict(detail);
		throw new Error(detail);
	}
	return data;
}

export async function planVideoEditorSync(
	workspaceID: string,
	input: components['schemas']['PlanVideoEditorSyncInputBody']
): Promise<VideoEditorSyncPlan> {
	const { data, error } = await client.POST('/video-editor/sync-plan', {
		params: { header: { 'X-OpenPost-Workspace-ID': workspaceID } },
		body: input
	});
	if (error || !data)
		throw new Error(error?.detail ?? 'OpenPost could not calculate the cloud sync estimate.');
	return data;
}

export async function listCloudVideoProjectRevisions(
	projectID: string
): Promise<CloudVideoProjectRevision[]> {
	const { data, error } = await client.GET('/video-editor/projects/{id}/revisions', {
		params: { path: { id: projectID } }
	});
	if (error || !data) throw new Error(error?.detail ?? 'Project history could not load.');
	return data.revisions ?? [];
}

export async function createCloudVideoProjectCheckpoint(
	projectID: string,
	name: string
): Promise<CloudVideoProjectRevision> {
	const { data, error } = await client.POST('/video-editor/projects/{id}/checkpoints', {
		params: { path: { id: projectID } },
		body: { name }
	});
	if (error || !data) throw new Error(error?.detail ?? 'The checkpoint could not be created.');
	return data;
}

export async function restoreCloudVideoProjectRevision(
	projectID: string,
	revisionID: string,
	expectedRevision: number
): Promise<CloudVideoProjectResponse> {
	const { data, error, response } = await client.POST(
		'/video-editor/projects/{id}/revisions/{revision_id}/restore',
		{
			params: { path: { id: projectID, revision_id: revisionID } },
			body: { expected_revision: expectedRevision }
		}
	);
	if (error || !data) {
		const detail = error?.detail ?? 'The project version could not be restored.';
		if (response.status === 409) throw new VideoProjectRevisionConflict(detail);
		throw new Error(detail);
	}
	return data;
}

export async function listStockProviders(): Promise<StockProvider[]> {
	const { data, error } = await client.GET('/stock-media/providers');
	if (error || !data) throw new Error(error?.detail ?? 'Stock media providers could not load.');
	return data.providers ?? [];
}

export async function searchStockMedia(input: {
	provider: string;
	query: string;
	kind: 'photo' | 'video';
	orientation?: 'landscape' | 'portrait' | 'square';
	page?: number;
	perPage?: number;
}): Promise<StockSearchPage> {
	const { data, error } = await client.GET('/stock-media/search', {
		params: {
			query: {
				provider: input.provider as 'pexels' | 'unsplash' | 'pixabay',
				query: input.query,
				kind: input.kind,
				orientation: input.orientation,
				page: input.page ?? 1,
				per_page: input.perPage ?? 24
			}
		}
	});
	if (error || !data) throw new Error(error?.detail ?? 'Stock media search failed.');
	return data;
}

export async function resolveStockAsset(
	provider: string,
	externalID: string
): Promise<ResolvedStockAsset> {
	const { data, error } = await client.POST('/stock-media/selections', {
		body: {
			provider: provider as 'pexels' | 'unsplash' | 'pixabay',
			external_id: externalID
		}
	});
	if (error || !data) throw new Error(error?.detail ?? 'That stock item is no longer available.');
	return data;
}

export async function createVideoReturnToken(input: {
	workspace_id: string;
	return_url: string;
	purpose: string;
	constraints: Record<string, unknown>;
}): Promise<components['schemas']['CreateVideoReturnTokenOutputBody']> {
	const { data, error } = await client.POST('/video-editor/return-tokens', { body: input });
	if (error || !data)
		throw new Error(error?.detail ?? 'OpenPost Video Editor could not be opened.');
	return data;
}

export async function completeVideoReturnToken(
	token: string,
	result: components['schemas']['VideoReturnResult']
): Promise<{ return_url: string }> {
	const { data, error } = await client.POST('/video-editor/return-tokens/{token}/complete', {
		params: { path: { token } },
		body: result
	});
	if (error || !data)
		throw new Error(error?.detail ?? 'OpenPost Video Editor exports could not be returned.');
	return data;
}

export async function consumeVideoReturnToken(
	token: string
): Promise<components['schemas']['ConsumeVideoReturnTokenOutputBody']> {
	const { data, error } = await client.POST('/video-editor/return-tokens/{token}/consume', {
		params: { path: { token } }
	});
	if (error || !data)
		throw new Error(error?.detail ?? 'OpenPost Video Editor exports could not be added.');
	return data;
}

export class VideoProjectRevisionConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VideoProjectRevisionConflict';
	}
}
