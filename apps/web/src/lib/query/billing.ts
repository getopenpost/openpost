import type { QueryClient } from '@tanstack/query-core';
import { billingMutationCachePlan, type BillingQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { executeQueryCachePlan } from './cache-plan';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createBillingQueryAPI(transport: QueryTransport): BillingQueryAPI {
	return {
		async getBillingStatus(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load billing status',
				request: (requestSignal) =>
					transport.GET('/billing/status', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getCheckoutConfig(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load checkout configuration',
				request: (requestSignal) =>
					transport.GET('/billing/checkout/config', { signal: requestSignal })
			});
			return data;
		}
	};
}

export const billingQueryAPI = createBillingQueryAPI(client);

export async function invalidateBillingDependencies(
	cache: Pick<QueryClient, 'invalidateQueries' | 'removeQueries'>,
	scope: { workspaceID: string; organizationID: string }
) {
	await executeQueryCachePlan(cache, billingMutationCachePlan(scope.organizationID));
}
