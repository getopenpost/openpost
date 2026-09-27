import { client } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import type { ScreenshotTemplateQueryAPI } from '@openpost/query-catalog';
import { queryGET } from './transport';

export function inScreenshotWorkspace<T extends { workspace_id: string }>(
	data: T,
	workspaceId: string
): T {
	if (data.workspace_id !== workspaceId) throw new Error(m.templates_workspace_changed());
	return data;
}

export const screenshotTemplateAPI: ScreenshotTemplateQueryAPI = {
	async list(workspaceId, offset, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.templates_load_failed(),
			request: (requestSignal) =>
				client.GET('/screenshot-templates/designs', {
					params: { query: { workspace_id: workspaceId, offset, limit: 40 } },
					signal: requestSignal
				})
		});
		return data;
	},
	async detail(workspaceId, id, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.templates_load_failed(),
			request: (requestSignal) =>
				client.GET('/screenshot-templates/designs/{id}', {
					params: { path: { id } },
					signal: requestSignal
				})
		});
		return inScreenshotWorkspace(data, workspaceId);
	},
	async recipe(workspaceId, mediaId, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.templates_load_failed(),
			request: (requestSignal) =>
				client.GET('/screenshot-templates/recipes/{media_id}', {
					params: { path: { media_id: mediaId } },
					signal: requestSignal
				})
		});
		return inScreenshotWorkspace(data, workspaceId);
	}
};
