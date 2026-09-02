import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createAdminQueryAPI } from './admin';

describe('admin query API', () => {
	it('maps normalized user filters to the generated API query', async () => {
		const page = { page: 2, per_page: 25, total: 0, total_pages: 0, users: [] };
		let request: Request | undefined;
		const fetchMock = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return Response.json(page);
		});
		const api = createAdminQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await expect(
			api.listInstanceUsers(
				{
					page: 2,
					perPage: 25,
					search: 'founder',
					sort: 'created_at',
					direction: 'desc'
				},
				controller.signal
			)
		).resolves.toEqual(page);
		expect(request).toBeDefined();
		const url = new URL(request!.url);
		expect(url.pathname).toBe('/api/v1/admin/users');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			page: '2',
			per_page: '25',
			search: 'founder',
			sort: 'created_at',
			direction: 'desc'
		});
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});
});
