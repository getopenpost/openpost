import { client } from '$lib/api/client';
import { queryGET, type QueryTransportResponse } from '$lib/query/transport';
import {
	captureQueryMutationSession,
	settleQueryMutationSession
} from '$lib/query/authorization-boundary';
import { queryClient } from '$lib/query/client';
import {
	screenshotTemplateKeys,
	type ScreenshotDocument,
	type ScreenshotTemplateQueryAPI
} from '@openpost/query-catalog';
import { m } from '$lib/paraglide/messages';

function inWorkspace<T extends { workspace_id: string }>(data: T, workspaceId: string): T {
	if (data.workspace_id !== workspaceId) throw new Error(m.templates_workspace_changed());
	return data;
}
export const screenshotTemplateAPI: ScreenshotTemplateQueryAPI = {
	async list(workspaceId, offset, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.templates_load_failed(),
			request: (signal) =>
				client.GET('/screenshot-templates/designs', {
					params: { query: { workspace_id: workspaceId, offset, limit: 40 } },
					signal
				})
		});
		return data;
	},
	async detail(workspaceId, id, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.templates_load_failed(),
			request: (signal) =>
				client.GET('/screenshot-templates/designs/{id}', {
					params: { path: { id } },
					signal
				})
		});
		return inWorkspace(data, workspaceId);
	},
	async recipe(workspaceId, mediaId, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.templates_load_failed(),
			request: (signal) =>
				client.GET('/screenshot-templates/recipes/{media_id}', {
					params: { path: { media_id: mediaId } },
					signal
				})
		});
		return inWorkspace(data, workspaceId);
	}
};
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
	inWorkspace(design, workspaceId);
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
export async function saveScreenshotExport(id: string, revision: number, mediaId: string) {
	return mutate(
		() =>
			client.POST('/screenshot-templates/designs/{id}/exports', {
				params: { path: { id } },
				body: { revision, media_id: mediaId }
			}),
		m.templates_save_failed()
	);
}
