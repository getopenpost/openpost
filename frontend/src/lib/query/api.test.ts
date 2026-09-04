import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createOpenPostQueryAPI } from './api';

describe('OpenPost web query API', () => {
	it('forwards cancellation and returns page metadata with Activity publications', async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn(async (_request: Request) => {
			return new Response('[]', {
				headers: {
					'Content-Type': 'application/json',
					'X-Next-Cursor': 'next-2',
					'X-Total-Count': '17'
				}
			});
		});
		const transport = createClient<paths>({
			baseUrl: 'https://openpost.test/api/v1',
			fetch: fetchMock
		});
		const api = createOpenPostQueryAPI(transport);

		await expect(
			api.listActivityPublications(
				'workspace-1',
				'scheduled',
				{ limit: 40, cursor: 'cursor-1' },
				controller.signal
			)
		).resolves.toEqual({ items: [], total: 17, nextCursor: 'next-2' });

		const request = fetchMock.mock.calls[0]?.[0];
		expect(request).toBeInstanceOf(Request);
		if (!request) throw new Error('Expected the Activity request');
		const url = new URL(request.url);
		expect(url.pathname).toBe('/api/v1/publications');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			workspace_id: 'workspace-1',
			activity_bucket: 'scheduled',
			limit: '40',
			offset: '0',
			cursor: 'cursor-1'
		});
		expect(request.signal.aborted).toBe(false);
		controller.abort();
		expect(request.signal.aborted).toBe(true);
	});
});
