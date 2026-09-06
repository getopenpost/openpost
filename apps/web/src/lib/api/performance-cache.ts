import type { QueryClient } from '@tanstack/svelte-query';
import {
	capabilityCatalogQueryOptions,
	openPostQueryKeys,
	publicationDetailQueryOptions,
	workspaceAccountsQueryOptions,
	workspaceSocialSetsQueryOptions,
	type OpenPostQueryAPI
} from '@openpost/query-catalog';
import { queryAPI } from '$lib/query/api';
import { queryClient } from '$lib/query/client';

export function createPerformanceCache(client: QueryClient, api: OpenPostQueryAPI) {
	async function loadPublicationDetail(publicationId: string, workspaceId: string, force = false) {
		const options = publicationDetailQueryOptions(api, workspaceId, publicationId);
		if (force) {
			await client.invalidateQueries({
				queryKey: options.queryKey,
				exact: true,
				refetchType: 'none'
			});
		}
		return client.query(options);
	}

	async function loadCapabilityCatalog(force = false) {
		const options = capabilityCatalogQueryOptions(api);
		if (force) {
			await client.invalidateQueries({
				queryKey: options.queryKey,
				exact: true,
				refetchType: 'none'
			});
		}
		return client.query(options);
	}

	async function loadWorkspaceAccounts(workspaceId: string, force = false) {
		const options = workspaceAccountsQueryOptions(api, workspaceId);
		if (force) {
			await client.invalidateQueries({
				queryKey: options.queryKey,
				exact: true,
				refetchType: 'none'
			});
		}
		return client.query(options);
	}

	async function loadWorkspaceSocialSets(workspaceId: string, force = false) {
		const options = workspaceSocialSetsQueryOptions(api, workspaceId);
		if (force) {
			await client.invalidateQueries({
				queryKey: options.queryKey,
				exact: true,
				refetchType: 'none'
			});
		}
		return client.query(options);
	}

	function invalidateWorkspaceSocialSets(workspaceId: string): void {
		void client.invalidateQueries({
			queryKey: openPostQueryKeys.socialSets(workspaceId),
			exact: true,
			refetchType: 'none'
		});
	}

	function prefetchDraftComposerData(publicationId: string, workspaceId: string): void {
		const requests: Promise<unknown>[] = [loadCapabilityCatalog()];
		if (workspaceId) {
			requests.push(
				loadPublicationDetail(publicationId, workspaceId),
				loadWorkspaceAccounts(workspaceId),
				loadWorkspaceSocialSets(workspaceId)
			);
		}
		void Promise.allSettled(requests);
	}

	return {
		invalidateWorkspaceSocialSets,
		loadCapabilityCatalog,
		loadPublicationDetail,
		loadWorkspaceAccounts,
		loadWorkspaceSocialSets,
		prefetchDraftComposerData
	};
}

const performanceCache = createPerformanceCache(queryClient, queryAPI);

export const {
	invalidateWorkspaceSocialSets,
	loadCapabilityCatalog,
	loadPublicationDetail,
	loadWorkspaceAccounts,
	loadWorkspaceSocialSets,
	prefetchDraftComposerData
} = performanceCache;
