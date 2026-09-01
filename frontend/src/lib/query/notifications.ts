import type { NotificationQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createNotificationQueryAPI(transport: QueryTransport): NotificationQueryAPI {
	return {
		async listNotifications(workspaceId, limit, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load notifications.',
				request: (requestSignal) =>
					transport.GET('/notifications', {
						params: {
							query: {
								workspace_id: workspaceId,
								limit,
								cursor: cursor || undefined
							}
						},
						signal: requestSignal
					})
			});
			return data;
		},
		async getNotificationPreferences(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load notification preferences.',
				request: (requestSignal) =>
					transport.GET('/notifications/preferences', { signal: requestSignal })
			});
			return data;
		}
	};
}

export const notificationQueryAPI = createNotificationQueryAPI(client);
