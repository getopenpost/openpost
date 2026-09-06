import type { QueryClient } from '@tanstack/svelte-query';
import { publicationInvalidationCachePlan } from '@openpost/query-catalog';
import type { PublicationInvalidationBatch } from '$lib/publication-invalidation';
import { executeQueryCachePlan } from './cache-plan';

type QueryInvalidator = Pick<QueryClient, 'invalidateQueries'>;

export function createPublicationQueryInvalidationBridge(client: QueryInvalidator) {
	let handledRevision = 0;

	return {
		async observe(batch: PublicationInvalidationBatch) {
			if (batch.revision === 0 || batch.revision <= handledRevision) return;
			handledRevision = batch.revision;
			await executeQueryCachePlan(client, publicationInvalidationCachePlan(batch.entries));
		}
	};
}
