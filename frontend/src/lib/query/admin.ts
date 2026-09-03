import type { AdminQueryAPI, AdminUsersQuery } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createAdminQueryAPI(transport: QueryTransport): AdminQueryAPI {
	return {
		async getInstanceOverview(signal) {
			return queryData(signal, 'Unable to load instance overview', (requestSignal) =>
				transport.GET('/admin/overview', { signal: requestSignal })
			);
		},
		async listInstanceUsers(filters, signal) {
			const query: AdminUsersQuery = {
				page: filters.page,
				per_page: filters.perPage,
				sort: filters.sort,
				direction: filters.direction
			};
			if (filters.search) query.search = filters.search;
			return queryData(signal, 'Unable to load instance users', (requestSignal) =>
				transport.GET('/admin/users', {
					params: { query },
					signal: requestSignal
				})
			);
		},
		async getAIPrompts(signal) {
			return queryData(signal, 'Unable to load AI prompts', (requestSignal) =>
				transport.GET('/admin/ai-prompts', { signal: requestSignal })
			);
		},
		async getInstanceSettings(signal) {
			return queryData(signal, 'Unable to load instance settings', (requestSignal) =>
				transport.GET('/admin/instance-settings', { signal: requestSignal })
			);
		},
		async listProviderApps(signal) {
			return queryData(signal, 'Unable to load provider applications', (requestSignal) =>
				transport.GET('/admin/provider-apps', { signal: requestSignal })
			);
		},
		async getUpdateStatus(signal) {
			return queryData(signal, 'Unable to load update status', (requestSignal) =>
				transport.GET('/admin/update-status', { signal: requestSignal })
			);
		}
	};
}

async function queryData<T>(
	signal: AbortSignal,
	fallback: string,
	request: (signal: AbortSignal) => Promise<{
		data?: T | null;
		error?: unknown;
		response: Response;
	}>
): Promise<T> {
	const { data } = await queryGET({ signal, fallback, request });
	return data;
}

export const adminQueryAPI = createAdminQueryAPI(client);
