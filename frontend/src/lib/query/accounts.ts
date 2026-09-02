import type { QueryClient } from '@tanstack/query-core';
import {
	adminQueryKeys,
	featureQueryKeys,
	openPostQueryKeys,
	publicProfileQueryKeys,
	type AccountCatalogQueryAPI,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
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
	cache.removeQueries({ queryKey: publicProfileQueryKeys.all() });
	await Promise.all([
		cache.invalidateQueries({
			queryKey: openPostQueryKeys.accounts(workspaceID),
			exact: true
		}),
		cache.invalidateQueries({
			queryKey: openPostQueryKeys.socialSets(workspaceID),
			exact: true
		}),
		cache.invalidateQueries({ queryKey: featureQueryKeys.all(workspaceID) }),
		cache.invalidateQueries({ queryKey: adminQueryKeys.usersRoot() }),
		cache.invalidateQueries({
			queryKey: workspaceSettingsQueryKeys.setup(workspaceID),
			exact: true
		})
	]);
}
