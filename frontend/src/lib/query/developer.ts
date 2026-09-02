import type { DeveloperQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createDeveloperQueryAPI(transport: QueryTransport): DeveloperQueryAPI {
	return {
		async listAPITokens(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load API tokens',
				request: (requestSignal) => transport.GET('/api-tokens', { signal: requestSignal })
			});
			return data;
		},
		async listMCPActivity(limit, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load MCP activity',
				request: (requestSignal) =>
					transport.GET('/mcp/activity', {
						params: { query: { limit } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const developerQueryAPI = createDeveloperQueryAPI(client);
