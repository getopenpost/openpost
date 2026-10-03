import type { PublicationBuildQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';
import { m } from '$lib/paraglide/messages';

export const publicationBuildQueryAPI: PublicationBuildQueryAPI = {
	async get(workspaceID, id, signal) {
		const { data } = await queryGET({
			signal,
			fallback: m.compose_ai_check_build_failed(),
			request: (signal) =>
				client.GET('/publication-builds/{id}', { params: { path: { id } }, signal })
		});
		if (data.workspace_id !== workspaceID) throw new Error(m.workflows_operation_failed());
		return data;
	}
};
