import type { QueryClient } from '@tanstack/query-core';
import { accountMutationCachePlan, type AccountCatalogQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { executeQueryCachePlan } from './cache-plan';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createAccountCatalogQueryAPI(transport: QueryTransport): AccountCatalogQueryAPI {
	return {
		async listAccountProviders(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load account providers',
				request: (requestSignal) =>
					transport.GET('/accounts/providers', {
						params: { query: { workspace_id: workspaceId || undefined } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const accountCatalogQueryAPI = createAccountCatalogQueryAPI(client);

export async function invalidateAccountMutationDependencies(
	cache: Pick<QueryClient, 'invalidateQueries' | 'removeQueries'>,
	workspaceID: string
) {
	await executeQueryCachePlan(cache, accountMutationCachePlan(workspaceID));
}
