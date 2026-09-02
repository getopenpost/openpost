import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalyticsQueryAPI } from './analytics';
import { registerQueryAuthorizationBoundary } from './authorization-boundary';
import { createInboxQueryAPI, InboxMessageQueryError } from './inbox';

afterEach(() => {
	registerQueryAuthorizationBoundary(undefined);
});

describe('engagement web query adapters', () => {
	it('forwards cancellation and every analytics result parameter', async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn(async () =>
			Response.json({
				account_growth_scope: 'account_wide',
				accounts: [],
				content: [],
				content_total: 0,
				coverage: [],
				follower_series: [],
				generated_at: '2026-09-01T12:00:00Z',
				insights: [],
				publication_total: 0,
				publications: [],
				range_days: 30,
				source: 'external',
				summary: {},
				trends: {}
			})
		);
		const transport = createClient<paths>({
			baseUrl: 'https://openpost.test/api/v1',
			fetch: fetchMock
		});
		const api = createAnalyticsQueryAPI(transport);

		await api.getAnalyticsOverview(
			'workspace-1',
			{
				days: 30,
				accountId: 'account-1',
				source: 'external',
				sort: 'views',
				limit: 50
			},
			'cursor-2',
			controller.signal
		);

		const request = fetchMock.mock.calls[0]?.[0];
		expect(request).toBeInstanceOf(Request);
		if (!(request instanceof Request)) throw new Error('Expected the analytics request');
		expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
			workspace_id: 'workspace-1',
			days: '30',
			account_id: 'account-1',
			source: 'external',
			sort: 'views',
			cursor: 'cursor-2',
			limit: '50'
		});
		controller.abort();
		expect(request.signal.aborted).toBe(true);
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

	it('settles a message-history 401 against the identity captured before the request', async () => {
		const identity = { userID: 'user-1', epoch: 7 };
		const settleUnauthorized = vi.fn();
		registerQueryAuthorizationBoundary({ captureIdentity: () => identity, settleUnauthorized });
		const transport = createClient<paths>({
			baseUrl: 'https://openpost.test/api/v1',
			fetch: vi.fn(async () =>
				Response.json(
					{ status: 401, detail: 'Session expired' },
					{ status: 401, headers: { 'Content-Type': 'application/problem+json' } }
				)
			)
		});

		await expect(
			createInboxQueryAPI(transport).listMessages(
				'workspace-1',
				'conversation-1',
				{ limit: 200 },
				'',
				new AbortController().signal
			)
		).rejects.toMatchObject({ name: 'InboxMessageQueryError', status: 401 });
		expect(settleUnauthorized).toHaveBeenCalledWith(identity);
	});
});
