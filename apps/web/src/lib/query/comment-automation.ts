import type { CommentAutomationQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';
import { m } from '$lib/paraglide/messages';
export const commentAutomationQueryAPI: CommentAutomationQueryAPI = {
	async list(workspaceID, itemID, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.workflows_load_failed(),
			request: (signal) =>
				client.GET('/engagement/{id}/automation', {
					params: { query: { workspace_id: workspaceID }, path: { id: itemID } },
					signal
				})
		});
		return data ?? [];
	}
};
