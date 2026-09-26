import type { PostImportQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

function createPostImportQueryAPI(transport: QueryTransport): PostImportQueryAPI {
	return {
		async readPostImports(workspaceID, accountID, signal, cursor) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load imported posts',
				request: (requestSignal) =>
					transport.GET('/accounts/{account_id}/post-imports', {
						params: {
							path: { account_id: accountID },
							query: { workspace_id: workspaceID, cursor }
						},
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const postImportQueryAPI = createPostImportQueryAPI(client);
