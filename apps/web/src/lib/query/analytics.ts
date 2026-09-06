import type { AnalyticsQueryAPI, NormalizedAnalyticsFilters } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createAnalyticsQueryAPI(transport: QueryTransport): AnalyticsQueryAPI {
	return {
		async getAnalyticsOverview(workspaceId, filters, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load analytics.',
				request: (requestSignal) =>
					transport.GET('/analytics', {
						params: { query: analyticsQuery(workspaceId, filters, cursor) },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

function analyticsQuery(workspaceId: string, filters: NormalizedAnalyticsFilters, cursor: string) {
	return {
		workspace_id: workspaceId,
		days: filters.days,
		account_id: filters.accountId || undefined,
		source: filters.source,
		sort: filters.sort,
		cursor: cursor || undefined,
		limit: filters.limit
	};
}

export const analyticsQueryAPI = createAnalyticsQueryAPI(client);
