import { client } from '$lib/api/client';
import { type QueryTransportResponse } from '$lib/query/transport';
import {
	captureQueryMutationSession,
	settleQueryMutationSession
} from '$lib/query/authorization-boundary';
import { queryClient } from '$lib/query/client';
import { inScreenshotWorkspace } from '$lib/query/screenshot-templates';
import {
	screenshotTemplateKeys,
	type ScreenshotDocument,
	type ScreenshotTemplateQueryAPI
} from '@openpost/query-catalog';
import { m } from '$lib/paraglide/messages';
import { LivePreviewError } from '$lib/live-preview.svelte';

export class ScreenshotSaveError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}
async function mutate<T>(
	request: () => Promise<QueryTransportResponse<T, { detail?: string }>>,
	fallback: string
): Promise<T | undefined> {
	const session = captureQueryMutationSession();
	const { data, error, response } = await request();
	if (!settleQueryMutationSession(session, response))
		throw new Error(m.templates_workspace_changed());
	if (!response.ok || error)
		throw new ScreenshotSaveError(response.status, error?.detail || fallback);
	return data ?? undefined;
}
async function cacheDesign(
	workspaceId: string,
	design: Awaited<ReturnType<ScreenshotTemplateQueryAPI['detail']>> | undefined
) {
	if (!design) throw new Error(m.templates_save_failed());
	inScreenshotWorkspace(design, workspaceId);
	queryClient.setQueryData(screenshotTemplateKeys.detail(workspaceId, design.id), design);
	await queryClient.invalidateQueries({
		queryKey: screenshotTemplateKeys.lists(workspaceId),
		refetchType: 'none'
	});
	return design;
}
export async function createScreenshotDesign(workspaceId: string, document: ScreenshotDocument) {
	const design = await mutate(
		() =>
			client.POST('/screenshot-templates/designs', {
				body: { workspace_id: workspaceId, document }
			}),
		m.templates_save_failed()
	);
	return cacheDesign(workspaceId, design);
}
export async function saveScreenshotDesign(
	workspaceId: string,
	id: string,
	revision: number,
	document: ScreenshotDocument
) {
	const design = await mutate(
		() =>
			client.PUT('/screenshot-templates/designs/{id}', {
				params: { path: { id } },
				body: { revision, document }
			}),
		m.templates_save_failed()
	);
	return cacheDesign(workspaceId, design);
}
export async function deleteScreenshotDesign(workspaceId: string, id: string) {
	await mutate(
		() =>
			client.DELETE('/screenshot-templates/designs/{id}', {
				params: { path: { id } }
			}),
		m.templates_save_failed()
	);
	queryClient.removeQueries({
		queryKey: screenshotTemplateKeys.detail(workspaceId, id)
	});
	await queryClient.invalidateQueries({
		queryKey: screenshotTemplateKeys.lists(workspaceId)
	});
}
export interface ScreenshotPreviewRegion {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface ScreenshotPreviewImage {
	url: string;
	width: number;
	height: number;
	scale: number;
	regions: ScreenshotPreviewRegion[];
}
// The server is the only renderer for templates. Live previews use JPEG;
// downloads ask for a lossless PNG of the same pixels.
export async function previewScreenshot(
	workspaceId: string,
	document: ScreenshotDocument,
	scale: 1 | 2,
	signal?: AbortSignal,
	format: 'jpeg' | 'png' = 'jpeg'
): Promise<ScreenshotPreviewImage> {
	const { data, error, response } = await client.POST('/screenshot-templates/previews', {
		body: { workspace_id: workspaceId, document, scale, format },
		signal
	});
	if (!response.ok || !data)
		throw new LivePreviewError(
			(error as { detail?: string } | undefined)?.detail || m.preview_load_failed(),
			response.status
		);
	return {
		url: `data:${data.mime_type};base64,${data.data_base64}`,
		width: data.width,
		height: data.height,
		scale: data.scale,
		regions: data.regions ?? []
	};
}
export async function exportScreenshotDesign(id: string, revision: number, altText = '') {
	const result = await mutate(
		() =>
			client.POST('/screenshot-templates/designs/{id}/exports', {
				params: { path: { id } },
				body: altText.trim() ? { revision, alt_text: altText.trim() } : { revision }
			}),
		m.templates_save_failed()
	);
	if (!result?.media) throw new Error(m.image_editor_export_failed());
	return result.media;
}
