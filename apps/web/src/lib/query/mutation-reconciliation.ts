import type { QueryClient, QueryFilters } from '@tanstack/svelte-query';
import { queryMutationSessionIsCurrent, type QueryMutationSession } from './authorization-boundary';

export interface QueryMutationReconciliation {
	readonly cancel?: readonly QueryFilters[];
	readonly reconcile?: () => void;
	readonly invalidate?: readonly QueryFilters[];
}

export async function reconcileQueryMutation(
	client: Pick<QueryClient, 'cancelQueries' | 'invalidateQueries'>,
	session: QueryMutationSession,
	plan: QueryMutationReconciliation
): Promise<boolean> {
	if (!queryMutationSessionIsCurrent(session)) return false;
	if (plan.cancel?.length) {
		await Promise.all(plan.cancel.map((filters) => client.cancelQueries(filters)));
	}
	if (!queryMutationSessionIsCurrent(session)) return false;

	plan.reconcile?.();
	if (!queryMutationSessionIsCurrent(session)) return false;

	for (const filters of plan.invalidate ?? []) {
		if (!queryMutationSessionIsCurrent(session)) return false;
		await client.invalidateQueries(filters);
	}
	return queryMutationSessionIsCurrent(session);
}
