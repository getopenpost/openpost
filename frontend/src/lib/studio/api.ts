import { client } from '$lib/api/client';
import type {
	StudioBrandKit,
	StudioDesignSummary,
	StudioDocument,
	StudioDocumentResponse,
	StudioMediaItem,
	StudioPreset,
	StudioRevisionSummary,
	StudioTemplate
} from './types';

function problemMessage(error: { detail?: string } | undefined, fallback: string): string {
	return error?.detail || fallback;
}

export async function loadStudioConfig(): Promise<{
	enabled: boolean;
	schema_version: number;
	background_model_base_url: string;
	presets: StudioPreset[];
}> {
	const { data, error } = await client.GET('/studio/presets', {});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load the Studio setup.'));
	return data as unknown as {
		enabled: boolean;
		schema_version: number;
		background_model_base_url: string;
		presets: StudioPreset[];
	};
}

export async function createStudioDesign(
	workspaceID: string,
	input: {
		title?: string;
		preset_key: string;
		width_px?: number;
		height_px?: number;
		source_media_id?: string;
		client_request_id?: string;
	}
): Promise<StudioDocumentResponse> {
	const { data, error } = await client.POST('/studio/designs', {
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
	return data as unknown as StudioDocumentResponse;
}

export async function loadStudioDesign(id: string): Promise<StudioDocumentResponse> {
	const { data, error } = await client.GET('/studio/designs/{id}', {
		params: { path: { id } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load the design.'));
	return data as unknown as StudioDocumentResponse;
}

export async function saveStudioDesign(
	id: string,
	revision: number,
	document: StudioDocument,
	coverPreviewMediaID = '',
	recoveryReason: 'idle' | 'export' | 'close' = 'idle'
): Promise<StudioDocumentResponse> {
	const { data, error, response } = await client.PATCH('/studio/designs/{id}', {
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
	return data as unknown as StudioDocumentResponse;
}

export async function listStudioDesigns(
	workspaceID: string,
	search = ''
): Promise<{ designs: StudioDesignSummary[]; total: number; can_edit: boolean }> {
	const { data, error } = await client.GET('/studio/designs', {
		params: { query: { workspace_id: workspaceID, search, limit: 100, offset: 0 } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load designs.'));
	return data as unknown as { designs: StudioDesignSummary[]; total: number; can_edit: boolean };
}

export async function deleteStudioDesign(id: string): Promise<void> {
	const { error } = await client.DELETE('/studio/designs/{id}', {
		params: { path: { id } }
	});
	if (error) throw new Error(problemMessage(error, 'Could not delete the design.'));
}

export async function toggleStudioDesignFavorite(id: string): Promise<boolean> {
	const { data, error } = await client.PATCH('/studio/designs/{id}/favorite', {
		params: { path: { id } }
	});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not update the design favorite.'));
	return data.is_favorite;
}

export async function listStudioTemplates(workspaceID: string): Promise<StudioTemplate[]> {
	const { data, error } = await client.GET('/studio/templates', {
		params: { query: { workspace_id: workspaceID } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load templates.'));
	return (data.templates ?? []) as unknown as StudioTemplate[];
}

export async function listPublicStudioTemplates(): Promise<StudioTemplate[]> {
	const { data, error } = await client.GET('/studio/public-templates', {});
	if (error || !data)
		throw new Error(problemMessage(error, 'Could not load Studio starter templates.'));
	return (data.templates ?? []) as unknown as StudioTemplate[];
}

export async function createStudioTemplate(input: {
	workspace_id: string;
	name: string;
	category: string;
	preview_media_id?: string;
	document: StudioDocument;
}): Promise<StudioTemplate> {
	const { data, error } = await client.POST('/studio/templates', {
		body: input as never
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the template.'));
	return data as unknown as StudioTemplate;
}

export async function updateStudioTemplate(
	id: string,
	input: {
		name: string;
		category: string;
		preview_media_id?: string;
		document: StudioDocument;
	}
): Promise<StudioTemplate> {
	const { data, error } = await client.PATCH('/studio/templates/{id}', {
		params: { path: { id } },
		body: input as never
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not replace the template.'));
	return data as unknown as StudioTemplate;
}

export async function deleteStudioTemplate(id: string): Promise<void> {
	const { error } = await client.DELETE('/studio/templates/{id}', {
		params: { path: { id } }
	});
	if (error) throw new Error(problemMessage(error, 'Could not delete the template.'));
}

export async function instantiateStudioTemplate(
	templateID: string,
	workspaceID: string,
	title?: string
): Promise<StudioDocumentResponse> {
	const { data, error } = await client.POST('/studio/templates/{id}/instantiate', {
		params: { path: { id: templateID } },
		body: { workspace_id: workspaceID, title: title ?? '' }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not use the template.'));
	return data as unknown as StudioDocumentResponse;
}

export async function loadStudioBrandKit(workspaceID: string): Promise<StudioBrandKit> {
	const { data, error } = await client.GET('/studio/brand-kit', {
		params: { query: { workspace_id: workspaceID } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load the brand kit.'));
	return data as unknown as StudioBrandKit;
}

export async function saveStudioBrandKit(
	kit: Pick<
		StudioBrandKit,
		'workspace_id' | 'name' | 'colors' | 'text_styles' | 'backgrounds' | 'assets' | 'fonts'
	>
): Promise<StudioBrandKit> {
	const { data, error } = await client.PUT('/studio/brand-kit', {
		body: {
			workspace_id: kit.workspace_id,
			name: kit.name,
			colors: kit.colors as never,
			text_styles: kit.text_styles as never,
			backgrounds: kit.backgrounds,
			assets: kit.assets.map((asset) => ({
				media_id: asset.media_id,
				role: asset.role,
				name: asset.name
			})),
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
	return data as unknown as StudioBrandKit;
}

export async function listStudioMedia(
	workspaceID: string,
	search = '',
	mediaType: 'image' | 'video' | 'all' = 'image'
): Promise<StudioMediaItem[]> {
	const { data, error } = await client.GET('/media', {
		params: {
			query: {
				workspace_id: workspaceID,
				search,
				type: mediaType,
				asset_kind: 'library',
				sort: 'newest',
				limit: 100,
				offset: 0
			}
		}
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load media.'));
	return (data.media ?? []) as unknown as StudioMediaItem[];
}

export async function listStudioRevisions(id: string): Promise<StudioRevisionSummary[]> {
	const { data, error } = await client.GET('/studio/designs/{id}/revisions', {
		params: { path: { id } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not load design history.'));
	return (data.revisions ?? []) as StudioRevisionSummary[];
}

export async function createStudioCheckpoint(
	id: string,
	name: string
): Promise<StudioRevisionSummary> {
	const { data, error } = await client.POST('/studio/designs/{id}/revisions', {
		params: { path: { id } },
		body: { name }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not create the checkpoint.'));
	return data as StudioRevisionSummary;
}

export async function restoreStudioRevision(
	id: string,
	revisionID: string,
	expectedRevision: number
): Promise<StudioDocumentResponse> {
	const { data, error } = await client.POST(
		'/studio/designs/{id}/revisions/{revision_id}/restore',
		{
			params: { path: { id, revision_id: revisionID } },
			body: { expected_revision: expectedRevision }
		}
	);
	if (error || !data) throw new Error(problemMessage(error, 'Could not restore this version.'));
	return data as unknown as StudioDocumentResponse;
}

export async function duplicateStudioDesign(id: string): Promise<StudioDocumentResponse> {
	const { data, error } = await client.POST('/studio/designs/{id}/duplicate', {
		params: { path: { id } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not duplicate the design.'));
	return data as unknown as StudioDocumentResponse;
}

export async function createStudioReturnToken(input: {
	workspace_id: string;
	return_url: string;
	purpose: string;
	max_selection: number;
	constraints: Record<string, unknown>;
}): Promise<{ token: string; expires_at: string }> {
	const { data, error } = await client.POST('/studio/return-tokens', { body: input as never });
	if (error || !data) throw new Error(problemMessage(error, 'Could not open Studio.'));
	return data as { token: string; expires_at: string };
}

export async function completeStudioReturnToken(
	token: string,
	designID: string,
	mediaIDs: string[]
): Promise<string> {
	const { data, error } = await client.POST('/studio/return-tokens/{token}/complete', {
		params: { path: { token } },
		body: { design_id: designID, media_ids: mediaIDs }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not return Studio exports.'));
	return data.return_url;
}

export async function consumeStudioReturnToken(token: string): Promise<{
	workspace_id: string;
	return_url: string;
	purpose: string;
	design_id: string;
	media_ids: string[];
	constraints: Record<string, unknown>;
}> {
	const { data, error } = await client.POST('/studio/return-tokens/{token}/consume', {
		params: { path: { token } }
	});
	if (error || !data) throw new Error(problemMessage(error, 'Could not restore Studio exports.'));
	return data as unknown as {
		workspace_id: string;
		return_url: string;
		purpose: string;
		design_id: string;
		media_ids: string[];
		constraints: Record<string, unknown>;
	};
}
