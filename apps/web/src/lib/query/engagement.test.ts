import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createInboxQueryAPI, InboxMessageQueryError } from './inbox';

describe('engagement web query adapters', () => {
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
