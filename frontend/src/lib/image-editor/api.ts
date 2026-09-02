import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { imageEditorQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import type {
	ImageEditorBrandKit,
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

function cacheImageEditorDesign(data: ImageEditorDocumentResponse): void {
	queryClient.setQueryData(imageEditorQueryKeys.design(data.workspace_id, data.id), data);
	void queryClient.invalidateQueries({
		queryKey: imageEditorQueryKeys.designLists(data.workspace_id),
		refetchType: 'none'
	});
}

function invalidateImageEditorRevisions(workspaceID: string, designID: string): void {
	void queryClient.invalidateQueries({
		queryKey: imageEditorQueryKeys.revisionLists(workspaceID, designID),
		refetchType: 'none'
	});
}

export async function createImageEditorDesign(
	workspaceID: string,
	input: CreateImageEditorDesignInput
): Promise<ImageEditorDocumentResponse> {
	const body: components['schemas']['CreateImageEditorDesignInputBody'] = {
		workspace_id: workspaceID,
		title: input.title ?? '',
		preset_key: input.preset_key,
		width_px: input.width_px ?? 0,
		height_px: input.height_px ?? 0
	};
	if (input.source_media_id) body.source_media_id = input.source_media_id;
	if (input.client_request_id) body.client_request_id = input.client_request_id;
	const { data, error } = await client.POST('/image-editor/designs', { body });
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the design.'));
	const design = imageEditorDocumentResponse(data);
	cacheImageEditorDesign(design);
	return design;
}

export async function saveImageEditorDesign(
	id: string,
	revision: number,
	document: ImageEditorDocument,
	coverPreviewMediaID = '',
	recoveryReason: 'idle' | 'export' | 'close' = 'idle'
): Promise<ImageEditorDocumentResponse> {
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
	if (error || !data) {
		throw new ImageEditorAPIError(
			problemMessage(error, 'Could not save the design.'),
			response.status
		);
	}
	const design = imageEditorDocumentResponse(data);
	cacheImageEditorDesign(design);
	invalidateImageEditorRevisions(design.workspace_id, design.id);
	return design;
}

export async function deleteImageEditorDesign(workspaceID: string, id: string): Promise<void> {
	const { error } = await client.DELETE('/image-editor/designs/{id}', {
		params: { path: { id } }
	});
	if (error) throw new Error(problemMessage(error, 'Could not delete the design.'));
	queryClient.removeQueries({
		queryKey: imageEditorQueryKeys.design(workspaceID, id)
	});
	void queryClient.invalidateQueries({
		queryKey: imageEditorQueryKeys.designLists(workspaceID),
		refetchType: 'none'
	});
}

export async function toggleImageEditorDesignFavorite(
	workspaceID: string,
	id: string
): Promise<boolean> {
	const { data, error } = await client.PATCH('/image-editor/designs/{id}/favorite', {
		params: { path: { id } }
	});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not update the design favorite.'));
	void queryClient.invalidateQueries({
		queryKey: imageEditorQueryKeys.designLists(workspaceID),
		refetchType: 'none'
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
	const { data, error } = await client.POST('/image-editor/templates', {
		body: imageEditorTemplateInput(input)
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the template.'));
	const template = imageEditorTemplate(data);
	void queryClient.invalidateQueries({
		queryKey: imageEditorQueryKeys.templates(input.workspace_id)
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
	const { data, error } = await client.PATCH('/image-editor/templates/{id}', {
		params: { path: { id } },
		body: imageEditorTemplateUpdateInput(input)
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not replace the template.'));
	const template = imageEditorTemplate(data);
	void queryClient.invalidateQueries({ queryKey: imageEditorQueryKeys.templates(workspaceID) });
	return template;
}

export async function instantiateImageEditorTemplate(
	templateID: string,
	workspaceID: string,
	title?: string
): Promise<ImageEditorDocumentResponse> {
	const { data, error } = await client.POST('/image-editor/templates/{id}/instantiate', {
		params: { path: { id: templateID } },
		body: { workspace_id: workspaceID, title: title ?? '' }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not use the template.'));
	const design = imageEditorDocumentResponse(data);
	cacheImageEditorDesign(design);
	return design;
}

export async function saveImageEditorBrandKit(
	kit: Pick<
		ImageEditorBrandKit,
		'workspace_id' | 'name' | 'colors' | 'text_styles' | 'backgrounds' | 'fonts'
	>
): Promise<ImageEditorBrandKit> {
	const { data, error } = await client.PUT('/image-editor/brand-kit', {
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
	if (error || !data) throw new Error(problemMessage(error, 'Could not save the brand kit.'));
	const brandKit = imageEditorBrandKit(data);
	queryClient.setQueryData(imageEditorQueryKeys.brandKit(brandKit.workspace_id), brandKit);
	return brandKit;
}

export async function createImageEditorCheckpoint(
	workspaceID: string,
	id: string,
	name: string,
	expectedRevision: number
): Promise<ImageEditorRevisionSummary> {
	const { data, error, response } = await client.POST('/image-editor/designs/{id}/revisions', {
		params: { path: { id } },
		body: { name, expected_revision: expectedRevision }
	});
	if (error || !data) {
		throw new ImageEditorAPIError(
			problemMessage(error, 'Could not create the checkpoint.'),
			response.status
		);
	}
	const revision = imageEditorRevisionSummary(data);
	invalidateImageEditorRevisions(workspaceID, id);
	return revision;
}

export async function restoreImageEditorRevision(
	workspaceID: string,
	id: string,
	revisionID: string,
	expectedRevision: number
): Promise<ImageEditorDocumentResponse> {
	const { data, error, response } = await client.POST(
		'/image-editor/designs/{id}/revisions/{revision_id}/restore',
		{
			params: { path: { id, revision_id: revisionID } },
			body: { expected_revision: expectedRevision }
		}
	);
	if (error || !data) {
		throw new ImageEditorAPIError(
			problemMessage(error, 'Could not restore this version.'),
			response.status
		);
	}
	const design = imageEditorDocumentResponse(data);
	cacheImageEditorDesign(design);
	invalidateImageEditorRevisions(workspaceID, id);
	return design;
}

export async function duplicateImageEditorDesign(id: string): Promise<ImageEditorDocumentResponse> {
	const { data, error } = await client.POST('/image-editor/designs/{id}/duplicate', {
		params: { path: { id } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not duplicate the design.'));
	const design = imageEditorDocumentResponse(data);
	cacheImageEditorDesign(design);
	return design;
}

export async function createImageEditorReturnToken(input: {
	workspace_id: string;
	return_url: string;
	purpose: string;
	max_selection: number;
	constraints: components['schemas']['CreateImageEditorReturnTokenInputBody']['constraints'];
}): Promise<{ token: string; expires_at: string }> {
	const { data, error } = await client.POST('/image-editor/return-tokens', { body: input });
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not open OpenPost Image Editor.'));
	return { token: data.token, expires_at: data.expires_at };
}

export async function completeImageEditorReturnToken(
	token: string,
	designID: string,
	mediaIDs: string[]
): Promise<string> {
	const { data, error } = await client.POST('/image-editor/return-tokens/{token}/complete', {
		params: { path: { token } },
		body: { design_id: designID, media_ids: mediaIDs }
	});
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
	const { data, error } = await client.POST('/image-editor/return-tokens/{token}/consume', {
		params: { path: { token } }
	});
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
