import type { ExternalApplicationQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createExternalApplicationQueryAPI(
	transport: QueryTransport
): ExternalApplicationQueryAPI {
	return {
		async listInstallations(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load connected applications',
				request: (requestSignal) =>
					transport.GET('/external-applications/installations', { signal: requestSignal })
			});
			return data;
		},
		async listAdminApplications(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load external applications',
				request: (requestSignal) =>
					transport.GET('/admin/external-applications', { signal: requestSignal })
			});
			return data;
		},
		async getAuthorizationRequest(clientId, redirectUri, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load the authorization request',
				request: (requestSignal) =>
					transport.GET('/external-applications/oauth/request', {
						params: { query: { client_id: clientId, redirect_uri: redirectUri } },
						signal: requestSignal
					})
			});
			return data;
		}
	};
}

export const externalApplicationQueryAPI = createExternalApplicationQueryAPI(client);
