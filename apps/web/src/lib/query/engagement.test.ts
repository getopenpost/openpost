import type { paths } from '@openpost/api-contract';
import { inboxSummaryQueryOptions } from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createInboxQueryAPI, InboxMessageQueryError } from './inbox';

describe('engagement web query adapters', () => {
	it('shares fresh Inbox summaries without carrying counts across workspaces', async () => {
		const fetchMock = vi.fn(async (request: Request) => {
			const url = new URL(request.url);
			expect(url.pathname).toBe('/api/v1/inbox/summary');
			return Response.json({
				unread_comments: url.searchParams.get('workspace_id') === 'workspace-1' ? 3 : 8,
				unread_conversations: 1
			});
		});
		const api = createInboxQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		try {
			const options = inboxSummaryQueryOptions(api, 'workspace-1');
			const [first, concurrent] = await Promise.all([
				queries.fetchQuery(options),
				queries.fetchQuery(options)
			]);
			expect(first).toEqual({ unread_comments: 3, unread_conversations: 1 });
			expect(concurrent).toEqual(first);
			await expect(queries.fetchQuery(options)).resolves.toEqual(first);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			await expect(
				queries.fetchQuery(inboxSummaryQueryOptions(api, 'workspace-2'))
			).resolves.toEqual({ unread_comments: 8, unread_conversations: 1 });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			queries.clear();
		}
	});

	it('preserves a failed message request reference for retry support', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json(
				{ status: 503, detail: 'Provider inbox unavailable' },
				{
					status: 503,
					headers: {
						'Content-Type': 'application/problem+json',
						'x-request-id': 'request-123'
					}
				}
			)
		);
		const transport = createClient<paths>({
			baseUrl: 'https://openpost.test/api/v1',
			fetch: fetchMock
		});
		const api = createInboxQueryAPI(transport);

		const request = api.listMessages(
			'workspace-1',
			'conversation-1',
			{ limit: 200 },
			'',
			new AbortController().signal
		);

		await expect(request).rejects.toEqual(
			expect.objectContaining<Partial<InboxMessageQueryError>>({
				name: 'InboxMessageQueryError',
				message: 'Provider inbox unavailable',
				requestId: 'request-123',
				status: 503
			})
		);
	});
});
