import type { FeatureQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createFeatureQueryAPI(transport: QueryTransport): FeatureQueryAPI {
	return {
		async listAccountFeatures(workspaceId, accountIds, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load account features.',
				request: async (requestSignal) => {
					const result = await transport.GET('/account-features', {
						params: {
							query: { workspace_id: workspaceId, account_ids: accountIds.join(',') }
						},
						signal: requestSignal
					});
					return { ...result, data: result.error ? undefined : (result.data ?? []) };
				}
			});
			return data;
		}
	};
}

export const featureQueryAPI = createFeatureQueryAPI(client);
