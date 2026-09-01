import type { QueryClient } from '@tanstack/svelte-query';
import {
	isOpenPostActivityQueryKey,
	isOpenPostDraftActivityQueryKey,
	openPostQueryKeys
} from '@openpost/query-catalog';
import type { PublicationInvalidationBatch } from '$lib/publication-invalidation';

type QueryInvalidator = Pick<QueryClient, 'invalidateQueries'>;

export function createPublicationQueryInvalidationBridge(client: QueryInvalidator) {
	let handledRevision = 0;

	return {
		async observe(batch: PublicationInvalidationBatch) {
			if (batch.revision === 0 || batch.revision <= handledRevision) return;
			handledRevision = batch.revision;

			const activityEntries = batch.entries.filter((entry) => entry.scopes.includes('activity'));
			const draftEntries = batch.entries.filter((entry) => entry.scopes.includes('drafts'));
			if (activityEntries.length === 0 && draftEntries.length === 0) return;

			if (activityEntries.some((entry) => entry.workspaceId === '*')) {
				await client.invalidateQueries({
					predicate: (query) => isOpenPostActivityQueryKey(query.queryKey)
				});
				return;
			}

			const activityWorkspaceIds = new Set(activityEntries.map((entry) => entry.workspaceId));
			const draftWorkspaceIds = new Set(
				draftEntries
					.map((entry) => entry.workspaceId)
					.filter((workspaceId) => workspaceId !== '*' && !activityWorkspaceIds.has(workspaceId))
			);
			const requests = [...activityWorkspaceIds].flatMap((workspaceId) => [
				client.invalidateQueries({
					queryKey: openPostQueryKeys.publications.activityRoot(workspaceId)
				}),
				client.invalidateQueries({ queryKey: openPostQueryKeys.jobs.failed(workspaceId) })
			]);
			if (draftEntries.some((entry) => entry.workspaceId === '*')) {
				requests.push(
					client.invalidateQueries({
						predicate: (query) => isOpenPostDraftActivityQueryKey(query.queryKey)
					})
				);
			}
			for (const workspaceId of draftWorkspaceIds) {
				requests.push(
					client.invalidateQueries({
						queryKey: openPostQueryKeys.publications.activityAll(workspaceId, 'draft')
					})
				);
			}
			await Promise.all(requests);
		}
	};
}
