import type {
	ImageEditorConfig,
	ImageEditorDesignPage,
	ImageEditorQueryAPI,
	ImageEditorQueryData,
	ImageEditorRevisionPageResult,
	NormalizedImageEditorDesignFilters,
	NormalizedImageEditorRevisionPage
} from '@openpost/query-catalog';
import {
	OpenPostQueryError,
	imageEditorBrandKitQueryOptions,
	imageEditorConfigQueryOptions,
	imageEditorDesignQueryOptions,
	imageEditorDesignsQueryOptions,
	imageEditorPublicTemplatesQueryOptions,
	imageEditorQueryKeys,
	imageEditorRevisionQueryOptions,
	imageEditorRevisionsQueryOptions,
	imageEditorTemplatesQueryOptions,
	mediaListQueryOptions
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import type {
	ImageEditorBrandKit,
	ImageEditorDesignSummary,
	ImageEditorDocumentResponse,
	ImageEditorMediaItem,
	ImageEditorRevisionResponse,
	ImageEditorRevisionSummary,
	ImageEditorTemplate
} from '$lib/image-editor/types';
import { mediaQueryAPI } from './media';
import { queryClient } from './client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;
type ApiImageEditorDocumentResponse = components['schemas']['ImageEditorDocumentResponse'];
type ApiImageEditorTemplate = components['schemas']['ImageEditorTemplateResponse'];
type ApiImageEditorBrandKit = components['schemas']['ImageEditorBrandKitResponse'];
type ApiImageEditorMediaItem = components['schemas']['MediaListItem'];
type ApiImageEditorRevisionResponse = components['schemas']['ImageEditorRevisionResponse'];
type ApiImageEditorRevisionSummary = components['schemas']['ImageEditorRevisionSummary'];

export interface WebImageEditorQueryData extends ImageEditorQueryData {
	design: ImageEditorDocumentResponse;
	designSummary: ImageEditorDesignSummary;
	template: ImageEditorTemplate;
	brandKit: ImageEditorBrandKit;
	revision: ImageEditorRevisionResponse;
	revisionSummary: ImageEditorRevisionSummary;
}

function imageEditorDocumentResponse(
	data: ApiImageEditorDocumentResponse
): ImageEditorDocumentResponse {
	// SAFETY: The backend persists and returns the same document contract that the editor validates before use.
	return data as ImageEditorDocumentResponse;
}

function imageEditorTemplate(data: ApiImageEditorTemplate): ImageEditorTemplate {
	// SAFETY: Template documents use the same persisted document contract that the editor validates.
	return data as ImageEditorTemplate;
}

function imageEditorBrandKit(data: ApiImageEditorBrandKit): ImageEditorBrandKit {
	return {
		...data,
		id: data.id ?? `${data.workspace_id}:brand-kit`,
		colors: data.colors ?? [],
		text_styles: data.text_styles ?? [],
		backgrounds: data.backgrounds ?? [],
		fonts: (data.fonts ?? []).map((font) => ({ ...font, id: font.id ?? font.media_id }))
	};
}

function imageEditorMediaItem(data: ApiImageEditorMediaItem): ImageEditorMediaItem {
	return { ...data, tags: data.tags ?? [] };
}

function imageEditorRevisionResponse(
	data: ApiImageEditorRevisionResponse
): ImageEditorRevisionResponse {
	// SAFETY: Revisions are immutable snapshots of the same document contract that the editor validates.
	return data as ImageEditorRevisionResponse;
}

function imageEditorRevisionSummary(
	data: ApiImageEditorRevisionSummary
): ImageEditorRevisionSummary {
	return data;
}

function requireImageEditorWorkspace<T extends { workspace_id: string }>(
	data: T,
	workspaceId: string
): T {
	if (data.workspace_id !== workspaceId) {
		throw new OpenPostQueryError('This Image Editor resource is not in the selected workspace', {
			status: 404
		});
	}
	return data;
}

export function createImageEditorQueryAPI(
	transport: QueryTransport
): ImageEditorQueryAPI<WebImageEditorQueryData> {
	return {
		async getConfig(signal): Promise<ImageEditorConfig> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load the OpenPost Image Editor setup.',
				request: (requestSignal) =>
					transport.GET('/image-editor/presets', { signal: requestSignal })
			});
			return {
				enabled: data.enabled,
				schema_version: data.schema_version,
				background_model_base_url: data.background_model_base_url,
				presets: (data.presets ?? []).map((preset) => ({
					...preset,
					profiles: preset.profiles ?? []
				}))
			};
		},
		async getDesign(workspaceId, designId, signal): Promise<ImageEditorDocumentResponse> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load the design.',
				request: (requestSignal) =>
					transport.GET('/image-editor/designs/{id}', {
						params: { path: { id: designId } },
						signal: requestSignal
					})
			});
			return requireImageEditorWorkspace(imageEditorDocumentResponse(data), workspaceId);
		},
		async listDesigns(
			workspaceId,
			filters,
			signal
		): Promise<ImageEditorDesignPage<ImageEditorDesignSummary>> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load designs.',
				request: (requestSignal) =>
					transport.GET('/image-editor/designs', {
						params: { query: designListQuery(workspaceId, filters) },
						signal: requestSignal
					})
			});
			return {
				designs: data.designs ?? [],
				total: data.total,
				canEdit: data.can_edit
			};
		},
		async listTemplates(workspaceId, signal): Promise<ImageEditorTemplate[]> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load templates.',
				request: (requestSignal) =>
					transport.GET('/image-editor/templates', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return (data.templates ?? []).map((template) => {
				const mapped = imageEditorTemplate(template);
				return requireImageEditorWorkspace(mapped, workspaceId);
			});
		},
		async listPublicTemplates(signal): Promise<ImageEditorTemplate[]> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load OpenPost Image Editor starter templates.',
				request: (requestSignal) =>
					transport.GET('/image-editor/public-templates', { signal: requestSignal })
			});
			return (data.templates ?? []).map(imageEditorTemplate);
		},
		async getBrandKit(workspaceId, signal): Promise<ImageEditorBrandKit> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load the brand kit.',
				request: (requestSignal) =>
					transport.GET('/image-editor/brand-kit', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return requireImageEditorWorkspace(imageEditorBrandKit(data), workspaceId);
		},
		async listRevisions(
			_workspaceId,
			designId,
			page,
			signal
		): Promise<ImageEditorRevisionPageResult<ImageEditorRevisionSummary>> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load design history.',
				request: (requestSignal) =>
					transport.GET('/image-editor/designs/{id}/revisions', {
						params: {
							path: { id: designId },
							query: revisionListQuery(page)
						},
						signal: requestSignal
					})
			});
			return {
				revisions: (data.revisions ?? []).map(imageEditorRevisionSummary),
				nextCursor: data.next_cursor ?? ''
			};
		},
		async getRevision(
			_workspaceId,
			designId,
			revisionId,
			signal
		): Promise<ImageEditorRevisionResponse> {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not inspect this version.',
				request: (requestSignal) =>
					transport.GET('/image-editor/designs/{id}/revisions/{revision_id}', {
						params: { path: { id: designId, revision_id: revisionId } },
						signal: requestSignal
					})
			});
			return imageEditorRevisionResponse(data);
		}
	};
}

function designListQuery(workspaceId: string, filters: NormalizedImageEditorDesignFilters) {
	return {
		workspace_id: workspaceId,
		search: filters.search,
		limit: filters.limit,
		offset: filters.offset
	};
}

function revisionListQuery(page: NormalizedImageEditorRevisionPage) {
	return {
		cursor: page.cursor,
		limit: page.limit
	};
}

export const imageEditorQueryAPI = createImageEditorQueryAPI(client);

export function queryImageEditorConfig() {
	return queryClient.query(imageEditorConfigQueryOptions(imageEditorQueryAPI));
}

export function queryImageEditorDesign(workspaceId: string, designId: string) {
	return queryClient.query(
		imageEditorDesignQueryOptions(imageEditorQueryAPI, workspaceId, designId)
	);
}

export async function refreshImageEditorDesign(workspaceId: string, designId: string) {
	await queryClient.invalidateQueries({
		queryKey: imageEditorQueryKeys.design(workspaceId, designId),
		exact: true,
		refetchType: 'none'
	});
	return queryImageEditorDesign(workspaceId, designId);
}

export function queryImageEditorDesigns(
	workspaceId: string,
	filters: Parameters<typeof imageEditorDesignsQueryOptions>[2] = {}
) {
	return queryClient.query(
		imageEditorDesignsQueryOptions(imageEditorQueryAPI, workspaceId, filters)
	);
}

export function queryImageEditorTemplates(workspaceId: string) {
	return queryClient.query(imageEditorTemplatesQueryOptions(imageEditorQueryAPI, workspaceId));
}

export function queryPublicImageEditorTemplates() {
	return queryClient.query(imageEditorPublicTemplatesQueryOptions(imageEditorQueryAPI));
}

export function queryImageEditorBrandKit(workspaceId: string) {
	return queryClient.query(imageEditorBrandKitQueryOptions(imageEditorQueryAPI, workspaceId));
}

export function queryImageEditorRevisions(
	workspaceId: string,
	designId: string,
	page: Parameters<typeof imageEditorRevisionsQueryOptions>[3] = {}
) {
	return queryClient.query(
		imageEditorRevisionsQueryOptions(imageEditorQueryAPI, workspaceId, designId, page)
	);
}

export function queryImageEditorRevision(
	workspaceId: string,
	designId: string,
	revisionId: string,
	signal?: AbortSignal
) {
	const options = imageEditorRevisionQueryOptions(
		imageEditorQueryAPI,
		workspaceId,
		designId,
		revisionId
	);
	if (!signal) return queryClient.query(options);
	if (signal.aborted)
		return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
	const cancel = () => {
		void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
	};
	signal.addEventListener('abort', cancel, { once: true });
	return queryClient.query(options).finally(() => signal.removeEventListener('abort', cancel));
}

export async function queryImageEditorMedia(
	workspaceId: string,
	search = '',
	mediaType: 'image' | 'video' | 'audio' | 'all' = 'image',
	options: {
		tagIds?: string[];
		untagged?: boolean;
		sort?: 'newest' | 'oldest' | 'name' | 'size' | 'recently_used';
	} = {}
): Promise<ImageEditorMediaItem[]> {
	const result = await queryClient.query(
		mediaListQueryOptions(mediaQueryAPI, workspaceId, {
			search,
			type: mediaType,
			assetKind: 'library',
			sort: options.sort ?? 'newest',
			tagIds: options.tagIds,
			untagged: options.untagged,
			limit: 100,
			offset: 0
		})
	);
	return (result.media ?? []).map(imageEditorMediaItem);
}
