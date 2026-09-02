import { describe, expect, it, vi } from 'vitest';
import { createAdminQueryAPI } from './admin';

describe('admin query API', () => {
	it('maps normalized user filters to the generated API query', async () => {
		const page = { page: 2, per_page: 25, total: 0, total_pages: 0, users: [] };
		const GET = vi.fn(async () => ({
			data: page,
			response: new Response(null, { status: 200 })
		}));
		const api = createAdminQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await expect(
			api.listInstanceUsers(
				{
					page: 2,
					perPage: 25,
					search: 'founder',
					sort: 'created_at',
					direction: 'desc'
				},
				signal
			)
		).resolves.toBe(page);
		expect(GET).toHaveBeenCalledWith('/admin/users', {
			params: {
				query: {
					page: 2,
					per_page: 25,
					search: 'founder',
					sort: 'created_at',
					direction: 'desc'
				}
			},
			signal
		});
	});
});
