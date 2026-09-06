import type { QueryClient } from '@tanstack/query-core';
import type { QueryCachePlan } from '@openpost/query-catalog';

type PlannedQueryCache = Pick<QueryClient, 'invalidateQueries'> &
	Partial<Pick<QueryClient, 'removeQueries'>>;

export async function executeQueryCachePlan(cache: PlannedQueryCache, plan: QueryCachePlan) {
	for (const filters of plan.remove ?? []) {
		if (!cache.removeQueries) throw new Error('The cache plan requires query removal support');
		cache.removeQueries(filters);
	}
	await Promise.all(plan.invalidate.map((filters) => cache.invalidateQueries(filters)));
}
