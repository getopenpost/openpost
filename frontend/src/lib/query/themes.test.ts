import { describe, expect, it, vi } from 'vitest';

import { createThemeQueryAPI } from './themes';

describe('theme query transport', () => {
	it('loads every available-theme page so custom themes remain visible after the built-ins', async () => {
		const pages = {
			'': { items: [{ reference: { id: 'workshop' } }], next_cursor: 'built-ins-done' },
			'built-ins-done': {
				items: [{ reference: { id: 'organization-theme' } }],
				next_cursor: null
			}
		};
		const get = vi.fn(async (_path: string, options: unknown) => {
			const query = (options as { params: { query: { cursor?: string; limit: number } } }).params
				.query;
			const cursor = (query.cursor ?? '') as keyof typeof pages;
			return {
				data: pages[cursor],
				response: new Response(null, { status: 200 })
			};
		});
		const api = createThemeQueryAPI({ GET: get } as unknown as Parameters<
			typeof createThemeQueryAPI
		>[0]);

		const result = await api.listAvailableThemes('workspace-1', new AbortController().signal);

		expect(result.items.map((item) => item.reference.id)).toEqual([
			'workshop',
			'organization-theme'
		]);
		expect(result.next_cursor).toBeNull();
		expect(get).toHaveBeenCalledTimes(2);
		expect(get.mock.calls.map(([, options]) => options.params.query)).toEqual([
			{ workspace_id: 'workspace-1', limit: 100 },
			{ workspace_id: 'workspace-1', limit: 100, cursor: 'built-ins-done' }
		]);
	});
});
