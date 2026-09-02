import type { FeedbackQueryAPI } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

export function createFeedbackQueryAPI(transport: QueryTransport): FeedbackQueryAPI {
	return {
		async getFeedbackConfig(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load feedback settings',
				request: (requestSignal) => transport.GET('/feedback/config', { signal: requestSignal })
			});
			return data;
		}
	};
}

export const feedbackQueryAPI = createFeedbackQueryAPI(client);
