import type { PublicProfileQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createPublicProfileQueryAPI(transport: QueryTransport): PublicProfileQueryAPI {
	return {
		async getPublicProfile(username, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load public profile',
				request: (requestSignal) =>
					transport.GET('/public/profiles/{username}', {
						params: { path: { username } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const publicProfileQueryAPI = createPublicProfileQueryAPI(client);
