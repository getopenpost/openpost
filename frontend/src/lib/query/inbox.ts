import type { components } from '@openpost/api-contract';
import {
	OpenPostQueryError,
	type InboxQueryAPI,
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

export function createInboxQueryAPI(transport: QueryTransport): InboxQueryAPI {
	return {
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
				fallback: 'Could not load publications.',
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
		limit: filters.limit,
		cursor: cursor || undefined
	};
}

export const inboxQueryAPI = createInboxQueryAPI(client);
