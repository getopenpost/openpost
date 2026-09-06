import { describe, expect, it, vi } from 'vitest';

import { createThemeQueryAPI } from './themes';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { themeMutationCachePlan, themeQueryKeys } from '@openpost/query-catalog';
import { executeQueryCachePlan } from './cache-plan';

describe('theme query transport', () => {
	it('refreshes an observed revision list once after a theme write', async () => {
		const cache = new QueryClient();
		const queryKey = themeQueryKeys.revisions('workspace-a', 'theme-a');
		cache.setQueryData(queryKey, { items: [] });
		const read = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
			signal.throwIfAborted();
			return { items: [] };
		});
		const observer = new QueryObserver(cache, { queryKey, queryFn: read, staleTime: Infinity });
		const unsubscribe = observer.subscribe(() => undefined);
		try {
			await executeQueryCachePlan(cache, themeMutationCachePlan('workspace-a', 'theme-a'));
			expect(read).toHaveBeenCalledOnce();
		} finally {
			unsubscribe();
			cache.clear();
		}
	});

	it('loads every available-theme page so custom themes remain visible after the built-ins', async () => {
		const pages = new Map([
			['', { items: [{ reference: { id: 'workshop' } }], next_cursor: 'built-ins-done' }],
			[
				'built-ins-done',
				{
					items: [{ reference: { id: 'organization-theme' } }],
					next_cursor: null
				}
			]
		]);
		const get = vi.fn(
			async (_path: string, options: { params: { query: { cursor?: string; limit: number } } }) => {
				const cursor = options.params.query.cursor ?? '';
				const page = pages.get(cursor);
				if (!page) throw new Error(`Unexpected theme page cursor: ${cursor}`);
				return {
					data: page,
					response: new Response(null, { status: 200 })
				};
			}
		);
		// SAFETY: This test calls only the mocked available-themes route above.
		const api = createThemeQueryAPI({ GET: get } as never);

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
