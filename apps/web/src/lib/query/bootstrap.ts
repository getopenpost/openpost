import type { AppBootstrapQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createAppBootstrapQueryAPI(transport: QueryTransport): AppBootstrapQueryAPI {
	return {
		async getAppBootstrap(preferredWorkspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load application state',
				request: (requestSignal) =>
					transport.GET('/app/bootstrap', {
						params: {
							query: {
								preferred_workspace_id: preferredWorkspaceId ?? undefined
							}
						},
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const appBootstrapQueryAPI = createAppBootstrapQueryAPI(client);
