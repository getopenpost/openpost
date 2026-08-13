import { client } from '$lib/api/client';
import type {
	ImageEditorBrandKit,
	ImageEditorDesignSummary,
	ImageEditorDocument,
	ImageEditorDocumentResponse,
	ImageEditorMediaItem,
	ImageEditorPreset,
	ImageEditorRevisionResponse,
	ImageEditorRevisionSummary,
	ImageEditorTemplate
} from './types';

function problemMessage(error: { detail?: string } | undefined, fallback: string): string {
	return error?.detail || fallback;
}

export async function loadImageEditorConfig(): Promise<{
	enabled: boolean;
	schema_version: number;
	background_model_base_url: string;
	presets: ImageEditorPreset[];
}> {
	const { data, error } = await client.GET('/image-editor/presets', {});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not load the OpenPost Image Editor setup.'));
	return data as unknown as {
		enabled: boolean;
		schema_version: number;
		background_model_base_url: string;
		presets: ImageEditorPreset[];
	};
}

export async function createImageEditorDesign(
	workspaceID: string,
	input: {
		title?: string;
		preset_key: string;
		width_px?: number;
		height_px?: number;
		source_media_id?: string;
		client_request_id?: string;
	}
): Promise<ImageEditorDocumentResponse> {
	const { data, error } = await client.POST('/image-editor/designs', {
		body: {
			workspace_id: workspaceID,
			title: input.title ?? '',
			preset_key: input.preset_key,
			width_px: input.width_px ?? 0,
			height_px: input.height_px ?? 0,
			...(input.source_media_id ? { source_media_id: input.source_media_id } : {}),
			...(input.client_request_id ? { client_request_id: input.client_request_id } : {})
		}
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the design.'));
	return data as unknown as ImageEditorDocumentResponse;
}

export async function loadImageEditorDesign(id: string): Promise<ImageEditorDocumentResponse> {
	const { data, error } = await client.GET('/image-editor/designs/{id}', {
		params: { path: { id } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load the design.'));
	return data as unknown as ImageEditorDocumentResponse;
}

export async function saveImageEditorDesign(
	id: string,
	revision: number,
	document: ImageEditorDocument,
	coverPreviewMediaID = '',
	recoveryReason: 'idle' | 'export' | 'close' = 'idle'
): Promise<ImageEditorDocumentResponse> {
	const { data, error, response } = await client.PATCH('/image-editor/designs/{id}', {
		params: { path: { id } },
		body: {
			expected_revision: revision,
			document: document as never,
			...(coverPreviewMediaID ? { cover_preview_media_id: coverPreviewMediaID } : {}),
			recovery_reason: recoveryReason
		}
	});
	if (error || !data) {
		const message = problemMessage(error, 'Could not save the design.');
		const conflict = new Error(message) as Error & { status?: number };
		conflict.status = response.status;
		throw conflict;
	}
	return data as unknown as ImageEditorDocumentResponse;
}

export interface ListImageEditorDesignsOptions {
	search?: string;
	limit?: number;
	offset?: number;
	signal?: AbortSignal;
}

export async function listImageEditorDesigns(
	workspaceID: string,
	options: ListImageEditorDesignsOptions = {}
): Promise<{ designs: ImageEditorDesignSummary[]; total: number; can_edit: boolean }> {
	const { data, error } = await client.GET('/image-editor/designs', {
		params: {
			query: {
				workspace_id: workspaceID,
				search: options.search ?? '',
				limit: options.limit ?? 100,
				offset: options.offset ?? 0
			}
		},
		signal: options.signal
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load designs.'));
	return data as unknown as {
		designs: ImageEditorDesignSummary[];
		total: number;
		can_edit: boolean;
	};
}

export async function deleteImageEditorDesign(id: string): Promise<void> {
	const { error } = await client.DELETE('/image-editor/designs/{id}', {
		params: { path: { id } }
	});
	if (error) throw new Error(problemMessage(error, 'Could not delete the design.'));
}

export async function toggleImageEditorDesignFavorite(id: string): Promise<boolean> {
	const { data, error } = await client.PATCH('/image-editor/designs/{id}/favorite', {
		params: { path: { id } }
	});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not update the design favorite.'));
	return data.is_favorite;
}

export async function listImageEditorTemplates(
	workspaceID: string
): Promise<ImageEditorTemplate[]> {
	const { data, error } = await client.GET('/image-editor/templates', {
		params: { query: { workspace_id: workspaceID } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load templates.'));
	return (data.templates ?? []) as unknown as ImageEditorTemplate[];
}

export async function listPublicImageEditorTemplates(): Promise<ImageEditorTemplate[]> {
	const { data, error } = await client.GET('/image-editor/public-templates', {});
	if (error || !data)
		throw new Error(
			problemMessage(error, 'Could not load OpenPost Image Editor starter templates.')
		);
	return (data.templates ?? []) as unknown as ImageEditorTemplate[];
}

export async function createImageEditorTemplate(input: {
	workspace_id: string;
	name: string;
	category: string;
	preview_media_id?: string;
	document: ImageEditorDocument;
}): Promise<ImageEditorTemplate> {
	const { data, error } = await client.POST('/image-editor/templates', {
		body: input as never
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the template.'));
	return data as unknown as ImageEditorTemplate;
}

export async function updateImageEditorTemplate(
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
		body: input as never
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not replace the template.'));
	return data as unknown as ImageEditorTemplate;
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
	return data as unknown as ImageEditorDocumentResponse;
}

export async function loadImageEditorBrandKit(workspaceID: string): Promise<ImageEditorBrandKit> {
	const { data, error } = await client.GET('/image-editor/brand-kit', {
		params: { query: { workspace_id: workspaceID } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load the brand kit.'));
	return data as unknown as ImageEditorBrandKit;
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
			colors: kit.colors as never,
			text_styles: kit.text_styles as never,
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
	return data as unknown as ImageEditorBrandKit;
}

export async function listImageEditorMedia(
	workspaceID: string,
	search = '',
	mediaType: 'image' | 'video' | 'audio' | 'all' = 'image',
	options: {
		tagIds?: string[];
		untagged?: boolean;
		sort?: 'newest' | 'oldest' | 'name' | 'size' | 'recently_used';
	} = {}
): Promise<ImageEditorMediaItem[]> {
	const { data, error } = await client.GET('/media', {
		params: {
			query: {
				workspace_id: workspaceID,
				search,
				type: mediaType,
				asset_kind: 'library',
				sort: options.sort ?? 'newest',
				tag_ids: options.tagIds?.join(',') ?? '',
				untagged: options.untagged ?? false,
				limit: 100,
				offset: 0
			}
		}
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load media.'));
	return (data.media ?? []) as unknown as ImageEditorMediaItem[];
}

export interface ImageEditorRevisionPage {
	revisions: ImageEditorRevisionSummary[];
	nextCursor?: string;
}

export async function listImageEditorRevisions(
	id: string,
	cursor = '',
	limit = 50
): Promise<ImageEditorRevisionPage> {
	const { data, error } = await client.GET('/image-editor/designs/{id}/revisions', {
		params: { path: { id }, query: { cursor, limit } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load design history.'));
	return {
		revisions: (data.revisions ?? []) as ImageEditorRevisionSummary[],
		nextCursor: data.next_cursor || undefined
	};
}

export async function getImageEditorRevision(
	id: string,
	revisionID: string,
	signal?: AbortSignal
): Promise<ImageEditorRevisionResponse> {
	const { data, error } = await client.GET('/image-editor/designs/{id}/revisions/{revision_id}', {
		params: { path: { id, revision_id: revisionID } },
		signal
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not inspect this version.'));
	return data as unknown as ImageEditorRevisionResponse;
}

export async function createImageEditorCheckpoint(
	id: string,
	name: string,
	expectedRevision: number
): Promise<ImageEditorRevisionSummary> {
	const { data, error, response } = await client.POST('/image-editor/designs/{id}/revisions', {
		params: { path: { id } },
		body: { name, expected_revision: expectedRevision }
	});
	if (error || !data) {
		const failure = new Error(
			problemMessage(error, 'Could not create the checkpoint.')
		) as Error & {
			status?: number;
		};
		failure.status = response.status;
		throw failure;
	}
	return data as ImageEditorRevisionSummary;
}

export async function restoreImageEditorRevision(
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
		const failure = new Error(problemMessage(error, 'Could not restore this version.')) as Error & {
			status?: number;
		};
		failure.status = response.status;
		throw failure;
	}
	return data as unknown as ImageEditorDocumentResponse;
}

export async function duplicateImageEditorDesign(id: string): Promise<ImageEditorDocumentResponse> {
	const { data, error } = await client.POST('/image-editor/designs/{id}/duplicate', {
		params: { path: { id } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not duplicate the design.'));
	return data as unknown as ImageEditorDocumentResponse;
}

export async function createImageEditorReturnToken(input: {
	workspace_id: string;
	return_url: string;
	purpose: string;
	max_selection: number;
	constraints: Record<string, unknown>;
}): Promise<{ token: string; expires_at: string }> {
	const { data, error } = await client.POST('/image-editor/return-tokens', {
		body: input as never
	});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not open OpenPost Image Editor.'));
	return data as { token: string; expires_at: string };
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
	constraints: Record<string, unknown>;
}> {
	const { data, error } = await client.POST('/image-editor/return-tokens/{token}/consume', {
		params: { path: { token } }
	});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not restore OpenPost Image Editor exports.'));
	return data as unknown as {
		workspace_id: string;
		return_url: string;
		purpose: string;
		design_id: string;
		media_ids: string[];
		constraints: Record<string, unknown>;
	};
}
