import type { GrowthQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createGrowthQueryAPI(transport: QueryTransport): GrowthQueryAPI {
	return {
		async getGrowth(workspaceId, accountId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load growth recommendations.',
				request: (requestSignal) =>
					transport.GET('/growth', {
						params: { query: { workspace_id: workspaceId, account_id: accountId } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const growthQueryAPI = createGrowthQueryAPI(client);
