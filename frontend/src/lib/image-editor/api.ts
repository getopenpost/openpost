import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { imageEditorQueryKeys, type ImageEditorDesignPage } from '@openpost/query-catalog';
import type { InfiniteData } from '@tanstack/svelte-query';
import { queryClient } from '$lib/query/client';
import {
	captureQueryMutationSession,
	settleQueryMutationSession,
	type QueryMutationSession
} from '$lib/query/authorization-boundary';
import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
import type {
	ImageEditorBrandKit,
	ImageEditorDesignSummary,
	ImageEditorDocument,
	ImageEditorDocumentResponse,
	ImageEditorRevisionSummary,
	ImageEditorTemplate
} from './types';

function problemMessage(error: { detail?: string } | undefined, fallback: string): string {
	return error?.detail || fallback;
}

type ApiImageEditorDocumentResponse = components['schemas']['ImageEditorDocumentResponse'];
type ApiImageEditorTemplate = components['schemas']['ImageEditorTemplateResponse'];
type ApiImageEditorBrandKit = components['schemas']['ImageEditorBrandKitResponse'];
type ApiImageEditorRevisionSummary = components['schemas']['ImageEditorRevisionSummary'];
type ImageEditorDesignListPage = ImageEditorDesignPage<ImageEditorDesignSummary>;
type ImageEditorDesignListCache =
	| ImageEditorDesignListPage
	| InfiniteData<ImageEditorDesignListPage, number>;

export interface CreateImageEditorDesignInput {
	title?: string;
	preset_key: string;
	width_px?: number;
	height_px?: number;
	source_media_id?: string;
	client_request_id?: string;
}

function imageEditorDocumentResponse(
	data: ApiImageEditorDocumentResponse
): ImageEditorDocumentResponse {
	// SAFETY: The image editor API stores documents through the same ImageEditorDocument contract used by the client; nullable array fields are normalized before persistence by the backend.
	return data as ImageEditorDocumentResponse;
}

function imageEditorTemplate(data: ApiImageEditorTemplate): ImageEditorTemplate {
	// SAFETY: Template documents use the same persisted ImageEditorDocument contract as designs.
	return data as ImageEditorTemplate;
}

function imageEditorTemplateInput(input: {
	workspace_id: string;
	name: string;
	category: string;
	preview_media_id?: string;
	document: ImageEditorDocument;
}): components['schemas']['CreateImageEditorTemplateInputBody'] {
	return {
		workspace_id: input.workspace_id,
		name: input.name,
		category: input.category,
		preview_media_id: input.preview_media_id,
		// SAFETY: ImageEditorDocument is the client mirror of ImageEditorDocumentPayload used by the generated API contract.
		document: input.document as components['schemas']['ImageEditorDocumentPayload']
	};
}

function imageEditorTemplateUpdateInput(input: {
	name: string;
	category: string;
	preview_media_id?: string;
	document: ImageEditorDocument;
}): components['schemas']['UpdateImageEditorTemplateInputBody'] {
	return {
		name: input.name,
		category: input.category,
		preview_media_id: input.preview_media_id,
		// SAFETY: ImageEditorDocument is the client mirror of ImageEditorDocumentPayload used by the generated API contract.
		document: input.document as components['schemas']['ImageEditorDocumentPayload']
	};
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

function imageEditorRevisionSummary(
	data: ApiImageEditorRevisionSummary
): ImageEditorRevisionSummary {
	return data;
}

class ImageEditorAPIError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export class ImageEditorWorkspaceMismatchError extends Error {
	constructor() {
		super('The Image Editor response is not in the selected workspace.');
		this.name = 'ImageEditorWorkspaceMismatchError';
	}
}

function requireImageEditorWorkspace<T extends { workspace_id: string }>(
	data: T,
	expectedWorkspaceID: string
): T {
	if (data.workspace_id !== expectedWorkspaceID) throw new ImageEditorWorkspaceMismatchError();
	return data;
}

function requireImageEditorDesignIdentity(
	design: ImageEditorDocumentResponse,
	expectedWorkspaceID: string,
	expectedDesignID?: string
): ImageEditorDocumentResponse {
	requireImageEditorWorkspace(design, expectedWorkspaceID);
	if (expectedDesignID && design.id !== expectedDesignID) {
		throw new ImageEditorWorkspaceMismatchError();
	}
	return design;
}

function requireImageEditorTemplateWorkspace(
	template: ImageEditorTemplate,
	expectedWorkspaceID: string
): ImageEditorTemplate {
	if (template.workspace_id !== expectedWorkspaceID) throw new ImageEditorWorkspaceMismatchError();
	return template;
}

function settleImageEditorMutation(
	session: QueryMutationSession,
	response: Pick<Response, 'status'>
): void {
	settleQueryMutationSession(session, response);
}

function updateDesignPage(
	page: ImageEditorDesignListPage,
	update: (design: ImageEditorDesignSummary) => ImageEditorDesignSummary | null
): ImageEditorDesignListPage {
	const designs = page.designs
		.map(update)
		.filter((design): design is ImageEditorDesignSummary => design !== null);
	return {
		...page,
		designs,
		total: Math.max(0, page.total - (page.designs.length - designs.length))
	};
}

function updateCachedDesignLists(
	workspaceID: string,
	update: (design: ImageEditorDesignSummary) => ImageEditorDesignSummary | null
): void {
	queryClient.setQueriesData<ImageEditorDesignListCache>(
		{ queryKey: imageEditorQueryKeys.designLists(workspaceID) },
		(current) => {
			if (!current) return current;
			if ('pages' in current) {
				return { ...current, pages: current.pages.map((page) => updateDesignPage(page, update)) };
			}
			return updateDesignPage(current, update);
		}
	);
}

function updateDesignSummary(
	current: ImageEditorDesignSummary,
	design: ImageEditorDocumentResponse
): ImageEditorDesignSummary {
	return {
		...current,
		title: design.document.title,
		preset_key: design.document.preset_key,
		width_px: design.document.width_px,
		height_px: design.document.height_px,
		page_count: design.document.pages.length,
		revision: design.revision,
		cover_preview_media_id: design.cover_preview_media_id,
		updated_at: design.updated_at
	};
}

async function reconcileImageEditorDesign(
	session: QueryMutationSession,
	workspaceID: string,
	designID: string,
	options: {
		design?: ImageEditorDocumentResponse;
		updateSummary?: (design: ImageEditorDesignSummary) => ImageEditorDesignSummary | null;
		remove?: boolean;
		invalidateRevisions?: boolean;
	} = {}
): Promise<boolean> {
	const designKey = imageEditorQueryKeys.design(workspaceID, designID);
	const revisionKey = imageEditorQueryKeys.revisionLists(workspaceID, designID);
	return reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey: designKey }, { queryKey: imageEditorQueryKeys.designLists(workspaceID) }],
		reconcile: () => {
			if (options.remove) queryClient.removeQueries({ queryKey: designKey });
			else if (options.design) queryClient.setQueryData(designKey, options.design);
			if (options.updateSummary) updateCachedDesignLists(workspaceID, options.updateSummary);
		},
		invalidate: [
			{ queryKey: imageEditorQueryKeys.designLists(workspaceID), refetchType: 'none' },
			...(options.invalidateRevisions
				? [{ queryKey: revisionKey, refetchType: 'none' } as const]
				: [])
		]
	});
}

async function reconcileImageEditorRevisions(
	session: QueryMutationSession,
	workspaceID: string,
	designID: string
): Promise<boolean> {
	const queryKey = imageEditorQueryKeys.revisionLists(workspaceID, designID);
	return reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey }],
		invalidate: [{ queryKey, refetchType: 'none' }]
	});
}

export async function createImageEditorDesign(
	workspaceID: string,
	input: CreateImageEditorDesignInput
): Promise<ImageEditorDocumentResponse> {
	const session = captureQueryMutationSession();
	const body: components['schemas']['CreateImageEditorDesignInputBody'] = {
		workspace_id: workspaceID,
		title: input.title ?? '',
		preset_key: input.preset_key,
		width_px: input.width_px ?? 0,
		height_px: input.height_px ?? 0
	};
	if (input.source_media_id) body.source_media_id = input.source_media_id;
	if (input.client_request_id) body.client_request_id = input.client_request_id;
	const { data, error, response } = await client.POST('/image-editor/designs', { body });
	settleImageEditorMutation(session, response);
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the design.'));
	const design = requireImageEditorDesignIdentity(imageEditorDocumentResponse(data), workspaceID);
	await reconcileImageEditorDesign(session, workspaceID, design.id, { design });
	return design;
}

export async function saveImageEditorDesign(
	workspaceID: string,
	id: string,
	revision: number,
	document: ImageEditorDocument,
	coverPreviewMediaID = '',
	recoveryReason: 'idle' | 'export' | 'close' = 'idle'
): Promise<ImageEditorDocumentResponse> {
	const session = captureQueryMutationSession();
	const body: components['schemas']['UpdateImageEditorDesignInputBody'] = {
		expected_revision: revision,
		// SAFETY: ImageEditorDocument is the client mirror of ImageEditorDocumentPayload used by the generated API contract.
		document: document as components['schemas']['ImageEditorDocumentPayload'],
		recovery_reason: recoveryReason
	};
	if (coverPreviewMediaID) body.cover_preview_media_id = coverPreviewMediaID;
	const { data, error, response } = await client.PATCH('/image-editor/designs/{id}', {
		params: { path: { id } },
		body
	});
	settleImageEditorMutation(session, response);
	if (error || !data) {
		throw new ImageEditorAPIError(
			problemMessage(error, 'Could not save the design.'),
			response.status
		);
	}
	const design = requireImageEditorDesignIdentity(
		imageEditorDocumentResponse(data),
		workspaceID,
		id
	);
	await reconcileImageEditorDesign(session, workspaceID, design.id, {
		design,
		updateSummary: (current) =>
			current.id === design.id ? updateDesignSummary(current, design) : current,
		invalidateRevisions: true
	});
	return design;
}

export async function deleteImageEditorDesign(workspaceID: string, id: string): Promise<void> {
	const session = captureQueryMutationSession();
	const { error, response } = await client.DELETE('/image-editor/designs/{id}', {
		params: { path: { id } }
	});
	settleImageEditorMutation(session, response);
	if (error) throw new Error(problemMessage(error, 'Could not delete the design.'));
	await reconcileImageEditorDesign(session, workspaceID, id, {
		remove: true,
		updateSummary: (current) => (current.id === id ? null : current)
	});
}

export async function toggleImageEditorDesignFavorite(
	workspaceID: string,
	id: string
): Promise<boolean> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.PATCH('/image-editor/designs/{id}/favorite', {
		params: { path: { id } }
	});
	settleImageEditorMutation(session, response);
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not update the design favorite.'));
	await reconcileImageEditorDesign(session, workspaceID, id, {
		updateSummary: (current) =>
			current.id === id ? { ...current, is_favorite: data.is_favorite } : current
	});
	return data.is_favorite;
}

export async function createImageEditorTemplate(input: {
	workspace_id: string;
	name: string;
	category: string;
	preview_media_id?: string;
	document: ImageEditorDocument;
}): Promise<ImageEditorTemplate> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/image-editor/templates', {
		body: imageEditorTemplateInput(input)
	});
	settleImageEditorMutation(session, response);
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the template.'));
	const template = requireImageEditorTemplateWorkspace(
		imageEditorTemplate(data),
		input.workspace_id
	);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey: imageEditorQueryKeys.templates(input.workspace_id), exact: true }],
		reconcile: () => {
			queryClient.setQueryData<ImageEditorTemplate[]>(
				imageEditorQueryKeys.templates(input.workspace_id),
				(current) => (current ? [...current, template] : current)
			);
		},
		invalidate: [{ queryKey: imageEditorQueryKeys.templates(input.workspace_id), exact: true }]
	});
	return template;
}

export async function updateImageEditorTemplate(
	workspaceID: string,
	id: string,
	input: {
		name: string;
		category: string;
		preview_media_id?: string;
		document: ImageEditorDocument;
	}
): Promise<ImageEditorTemplate> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.PATCH('/image-editor/templates/{id}', {
		params: { path: { id } },
		body: imageEditorTemplateUpdateInput(input)
	});
	settleImageEditorMutation(session, response);
	if (error || !data) throw new Error(problemMessage(error, 'Could not replace the template.'));
	const template = requireImageEditorTemplateWorkspace(imageEditorTemplate(data), workspaceID);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey: imageEditorQueryKeys.templates(workspaceID), exact: true }],
		reconcile: () => {
			queryClient.setQueryData<ImageEditorTemplate[]>(
				imageEditorQueryKeys.templates(workspaceID),
				(current) =>
					current?.map((candidate) => (candidate.id === template.id ? template : candidate))
			);
		},
		invalidate: [{ queryKey: imageEditorQueryKeys.templates(workspaceID), exact: true }]
	});
	return template;
}

export async function instantiateImageEditorTemplate(
	templateID: string,
	workspaceID: string,
	title?: string
): Promise<ImageEditorDocumentResponse> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/image-editor/templates/{id}/instantiate', {
		params: { path: { id: templateID } },
		body: { workspace_id: workspaceID, title: title ?? '' }
	});
	settleImageEditorMutation(session, response);
	if (error || !data) throw new Error(problemMessage(error, 'Could not use the template.'));
	const design = requireImageEditorDesignIdentity(imageEditorDocumentResponse(data), workspaceID);
	await reconcileImageEditorDesign(session, workspaceID, design.id, { design });
	return design;
}

export async function saveImageEditorBrandKit(
	kit: Pick<
		ImageEditorBrandKit,
		'workspace_id' | 'name' | 'colors' | 'text_styles' | 'backgrounds' | 'fonts'
	>
): Promise<ImageEditorBrandKit> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.PUT('/image-editor/brand-kit', {
		body: {
			workspace_id: kit.workspace_id,
			name: kit.name,
			colors: kit.colors,
			text_styles: kit.text_styles,
			backgrounds: kit.backgrounds,
			fonts: kit.fonts.map((font) => ({
				media_id: font.media_id,
				family: font.family,
				weight: font.weight,
				style: font.style,
				license_acknowledged: true
			}))
		}
	});
	settleImageEditorMutation(session, response);
	if (error || !data) throw new Error(problemMessage(error, 'Could not save the brand kit.'));
	const brandKit = requireImageEditorWorkspace(imageEditorBrandKit(data), kit.workspace_id);
	const queryKey = imageEditorQueryKeys.brandKit(kit.workspace_id);
	await reconcileQueryMutation(queryClient, session, {
		cancel: [{ queryKey, exact: true }],
		reconcile: () => queryClient.setQueryData(queryKey, brandKit)
	});
	return brandKit;
}

export async function createImageEditorCheckpoint(
	workspaceID: string,
	id: string,
	name: string,
	expectedRevision: number
): Promise<ImageEditorRevisionSummary> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/image-editor/designs/{id}/revisions', {
		params: { path: { id } },
		body: { name, expected_revision: expectedRevision }
	});
	settleImageEditorMutation(session, response);
	if (error || !data) {
		throw new ImageEditorAPIError(
			problemMessage(error, 'Could not create the checkpoint.'),
			response.status
		);
	}
	const revision = imageEditorRevisionSummary(data);
	await reconcileImageEditorRevisions(session, workspaceID, id);
	return revision;
}

export async function restoreImageEditorRevision(
	workspaceID: string,
	id: string,
	revisionID: string,
	expectedRevision: number
): Promise<ImageEditorDocumentResponse> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST(
		'/image-editor/designs/{id}/revisions/{revision_id}/restore',
		{
			params: { path: { id, revision_id: revisionID } },
			body: { expected_revision: expectedRevision }
		}
	);
	settleImageEditorMutation(session, response);
	if (error || !data) {
		throw new ImageEditorAPIError(
			problemMessage(error, 'Could not restore this version.'),
			response.status
		);
	}
	const design = requireImageEditorDesignIdentity(
		imageEditorDocumentResponse(data),
		workspaceID,
		id
	);
	await reconcileImageEditorDesign(session, workspaceID, id, {
		design,
		updateSummary: (current) =>
			current.id === id ? updateDesignSummary(current, design) : current,
		invalidateRevisions: true
	});
	return design;
}

export async function duplicateImageEditorDesign(
	workspaceID: string,
	id: string
): Promise<ImageEditorDocumentResponse> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/image-editor/designs/{id}/duplicate', {
		params: { path: { id } }
	});
	settleImageEditorMutation(session, response);
	if (error || !data) throw new Error(problemMessage(error, 'Could not duplicate the design.'));
	const design = requireImageEditorDesignIdentity(imageEditorDocumentResponse(data), workspaceID);
	await reconcileImageEditorDesign(session, workspaceID, design.id, { design });
	return design;
}

export async function createImageEditorReturnToken(input: {
	workspace_id: string;
	return_url: string;
	purpose: string;
	max_selection: number;
	constraints: components['schemas']['CreateImageEditorReturnTokenInputBody']['constraints'];
}): Promise<{ token: string; expires_at: string }> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST('/image-editor/return-tokens', {
		body: input
	});
	settleImageEditorMutation(session, response);
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not open OpenPost Image Editor.'));
	return { token: data.token, expires_at: data.expires_at };
}

export async function completeImageEditorReturnToken(
	token: string,
	designID: string,
	mediaIDs: string[]
): Promise<string> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST(
		'/image-editor/return-tokens/{token}/complete',
		{
			params: { path: { token } },
			body: { design_id: designID, media_ids: mediaIDs }
		}
	);
	settleImageEditorMutation(session, response);
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not return OpenPost Image Editor exports.'));
	return data.return_url;
}

export async function consumeImageEditorReturnToken(token: string): Promise<{
	workspace_id: string;
	return_url: string;
	purpose: string;
	design_id: string;
	media_ids: string[];
	constraints: components['schemas']['ConsumeImageEditorReturnTokenOutputBody']['constraints'];
}> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await client.POST(
		'/image-editor/return-tokens/{token}/consume',
		{
			params: { path: { token } }
		}
	);
	settleImageEditorMutation(session, response);
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not restore OpenPost Image Editor exports.'));
	return {
		workspace_id: data.workspace_id,
		return_url: data.return_url,
		purpose: data.purpose,
		design_id: data.design_id,
		media_ids: data.media_ids ?? [],
		constraints: data.constraints
	};
}
