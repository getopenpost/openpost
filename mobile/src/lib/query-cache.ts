import type { QueryClient } from "@tanstack/react-query";
import {
  capturePublicationDetailRequestContext,
  capturePublicationListCacheContext,
  reconcilePublicationDetailResponse,
  requirePublicationWorkspace,
  seedPublicationDetail,
  type PublicationDetailRequestContext,
  type PublicationListCacheContext,
} from "@openpost/query-catalog";
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

import type { components } from "./api/schema";
import { publicationRefreshKeys, queryKeys, type PublicationRefreshRequest } from "./query-policy";
import { querySessionIsCurrent, type WorkspaceQueryScope } from "./query-session";

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
    if (!Array.isArray(query.state.data)) continue;
    const publication = (query.state.data as Publication[]).find(
      (candidate) => candidate.id === publicationId && candidate.workspace_id === workspaceId,
    );
    if (!publication || (match && match.updatedAt >= query.state.dataUpdatedAt)) continue;
    match = { data: publication, updatedAt: query.state.dataUpdatedAt };
  }

  return match;
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
  if (!querySessionIsCurrent(scope)) return validated;
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
  queryClient.setQueryData<Publication[]>(
    queryKeys.publicationActivity(workspaceId, "draft"),
    (current) =>
      current
        ? [publication, ...current.filter((candidate) => candidate.id !== publication.id)]
        : undefined,
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
