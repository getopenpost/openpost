import type { components } from '@openpost/api-contract';
import {
	OpenPostQueryError,
	type InboxQueryAPI,
	type InboxSummaryQueryAPI,
	type JobStatusQueryAPI,
	type InboxUpdateAPI,
	type XMessagingQueryAPI,
	type NormalizedConversationFilters,
	type NormalizedEngagementFilters
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET, queryTransportRequest } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;
type APIProblem = components['schemas']['ErrorModel'];

export class InboxMessageQueryError extends OpenPostQueryError {
	readonly requestId: string;

	constructor(status: number, problem: APIProblem | undefined, response: Response) {
		const detail = problem?.detail?.trim() || 'Could not load conversation messages.';
		super(detail, { status, detail, cause: problem });
		this.name = 'InboxMessageQueryError';
		this.requestId = response.headers.get('x-request-id') ?? '';
	}
}

export function createInboxQueryAPI(
	transport: QueryTransport
): InboxQueryAPI & InboxSummaryQueryAPI & JobStatusQueryAPI {
	return {
		async getInboxSummary(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load Inbox summary.',
				request: (requestSignal) =>
					transport.GET('/inbox/summary', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getJob(_workspaceId, jobId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not inspect Inbox action.',
				request: (signal) =>
					transport.GET('/jobs/{id}', { params: { path: { id: jobId } }, signal })
			});
			return data;
		},
		async getEngagement(workspaceId, itemId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load comment.',
				request: (signal) =>
					transport.GET('/engagement/{item_id}', {
						params: { path: { item_id: itemId }, query: { workspace_id: workspaceId } },
						signal
					})
			});
			return data;
		},
		async listEngagement(workspaceId, filters, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load engagement.',
				request: (requestSignal) =>
					transport.GET('/engagement', {
						params: { query: engagementQuery(workspaceId, filters, cursor) },
						signal: requestSignal
					})
			});
			return data;
		},
		async listConversations(workspaceId, filters, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Could not load conversations.',
				request: (requestSignal) =>
					transport.GET('/messages', {
						params: { query: conversationQuery(workspaceId, filters, cursor) },
						signal: requestSignal
					})
			});
			return data;
		},
		async listMessages(workspaceId, conversationId, filters, cursor, signal) {
			const { data, error, response } = await queryTransportRequest(signal, (requestSignal) =>
				transport.GET('/messages/{conversation_id}', {
					params: {
						path: { conversation_id: conversationId },
						query: {
							workspace_id: workspaceId,
							limit: filters.limit,
							cursor: cursor || undefined
						}
					},
					signal: requestSignal
				})
			);
			if (error || !data) throw new InboxMessageQueryError(response.status, error, response);
			return data;
		},
		async listPublications(workspaceId, filters, cursor, signal) {
			const { data, response } = await queryGET({
				signal,
				fallback: 'Could not load posts.',
				request: async (requestSignal) => {
					const result = await transport.GET('/publications', {
						params: {
							query: {
								workspace_id: workspaceId,
								search: filters.search || undefined,
								limit: filters.limit,
								cursor: cursor || undefined
							}
						},
						signal: requestSignal
					});
					return { ...result, data: result.error ? undefined : (result.data ?? []) };
				}
			});
			return { items: data, nextCursor: response.headers.get('X-Next-Cursor') ?? '' };
		}
	};
}

function engagementQuery(
	workspaceId: string,
	filters: NormalizedEngagementFilters,
	cursor: string
) {
	return {
		workspace_id: workspaceId,
		platform: filters.platform || undefined,
		account_id: filters.accountId || undefined,
		publication_id: filters.publicationId || undefined,
		kind: filters.kind,
		unread_only: filters.unreadOnly,
		archived: filters.archived,
		limit: filters.limit,
		cursor: cursor || undefined
	};
}

function conversationQuery(
	workspaceId: string,
	filters: NormalizedConversationFilters,
	cursor: string
) {
	return {
		workspace_id: workspaceId,
		platform: filters.platform || undefined,
		account_id: filters.accountId || undefined,
		archived: filters.archived,
		search: filters.search || undefined,
		unread_only: filters.unreadOnly,
		limit: filters.limit,
		cursor: cursor || undefined
	};
}

export const inboxQueryAPI = createInboxQueryAPI(client);

export const inboxUpdateAPI: InboxUpdateAPI = {
	async inboxChanges(workspaceId, cursor, signal) {
		const { data } = await queryGET({
			signal,
			fallback: 'Could not load inbox updates.',
			request: (signal) =>
				client.GET('/inbox/changes', {
					params: { query: { workspace_id: workspaceId, cursor, wait_seconds: 25 } },
					signal
				})
		});
		return { ...data, changes: data.changes ?? [] };
	},
	async inboxActivity(workspaceId, activity, signal) {
		const { error, response } = await queryTransportRequest(signal, (signal) =>
			client.POST('/inbox/activity', {
				body: {
					workspace_id: workspaceId,
					client_id: activity.clientId,
					view: activity.view,
					conversation_id: activity.conversationId
				},
				signal
			})
		);
		if (error)
			throw new OpenPostQueryError('Could not update inbox activity.', { status: response.status });
	}
};

export const xMessagingQueryAPI: XMessagingQueryAPI = {
	async getReadiness(workspaceId, accountId, signal) {
		const { data } = await queryGET({
			signal,
			fallback: 'Could not load X messaging access.',
			request: (signal) =>
				client.GET('/accounts/{account_id}/messaging/x', {
					params: { path: { account_id: accountId }, query: { workspace_id: workspaceId } },
					signal
				})
		});
		return data;
	}
};
