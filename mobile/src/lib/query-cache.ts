import type { QueryClient } from "@tanstack/react-query";
import type { components } from "@openpost/api-contract";
import {
  requirePublicationWorkspace,
  seedPublicationDetail,
  type PublicationListCacheContext,
  type QueryPageResult,
} from "@openpost/query-catalog";
import {
  mobileQueryDimensions,
  publicationRefreshKeys,
  queryKeys,
  type PublicationRefreshRequest,
} from "./query-policy";
import { queryActorScopeIsCurrent, type WorkspaceQueryScope } from "./query-session";

export {
  capturePublicationDetailRequestContext,
  capturePublicationListCacheContext,
  reconcilePublicationDetailResponse,
  requirePublicationWorkspace,
} from "@openpost/query-catalog";
export type {
  PublicationDetailRequestContext,
  PublicationListCacheContext,
} from "@openpost/query-catalog";

export type Publication = components["schemas"]["PublicationResponse"];

export type CachedPublication = {
  data: Publication;
  updatedAt: number;
};

export function findCachedPublication(
  queryClient: QueryClient,
  workspaceId: string,
  publicationId: string,
): CachedPublication | undefined {
  let match: CachedPublication | undefined;
  const queryCache = queryClient.getQueryCache();
  const queries = [
    ...queryCache.findAll({ queryKey: queryKeys.publicationLists(workspaceId) }),
    ...queryCache.findAll({ queryKey: queryKeys.calendar(workspaceId) }),
  ];

  for (const query of queries) {
    const publications = cachedPublications(query.state.data);
    if (!publications) continue;
    const publication = publications.find(
      (candidate) => candidate.id === publicationId && candidate.workspace_id === workspaceId,
    );
    if (!publication || (match && match.updatedAt >= query.state.dataUpdatedAt)) continue;
    match = { data: publication, updatedAt: query.state.dataUpdatedAt };
  }

  return match;
}

function cachedPublications(data: unknown): Publication[] | undefined {
  if (Array.isArray(data)) return data as Publication[];
  if (!data || typeof data !== "object" || !("items" in data) || !Array.isArray(data.items)) {
    return undefined;
  }
  return data.items as Publication[];
}

export function cachePublication(
  queryClient: QueryClient,
  workspaceId: string,
  publication: Publication,
  listContext?: PublicationListCacheContext,
): void {
  seedPublicationDetail(queryClient, publication, workspaceId, listContext);
}

export function cachePublicationDetails(
  queryClient: QueryClient,
  scope: WorkspaceQueryScope,
  publications: Publication[],
  listContext: PublicationListCacheContext,
): Publication[] {
  const validated = publications.map((publication) =>
    requirePublicationWorkspace(publication, scope.workspaceId),
  );
  if (!queryActorScopeIsCurrent(scope)) return validated;
  for (const publication of validated) {
    cachePublication(queryClient, scope.workspaceId, publication, listContext);
  }
  return validated;
}

export function cacheCreatedPublication(
  queryClient: QueryClient,
  workspaceId: string,
  publication: Publication,
): void {
  cachePublication(queryClient, workspaceId, publication);
  queryClient.setQueryData<QueryPageResult<Publication>>(
    queryKeys.publicationActivity(workspaceId, "draft"),
    (current) => {
      if (!current) return undefined;
      const alreadyCached = current.items.some((candidate) => candidate.id === publication.id);
      return {
        ...current,
        items: [
          publication,
          ...current.items.filter((candidate) => candidate.id !== publication.id),
        ].slice(0, mobileQueryDimensions.publicationPage.limit),
        total: current.total + (alreadyCached ? 0 : 1),
      };
    },
  );
}

export async function invalidatePublicationData(
  queryClient: QueryClient,
  request: PublicationRefreshRequest,
): Promise<void> {
  await Promise.all(
    publicationRefreshKeys(request).map(({ queryKey, exact }) =>
      queryClient.invalidateQueries({ queryKey, exact }),
    ),
  );
}
