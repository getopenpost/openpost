import type { QueryClient } from "@tanstack/react-query";

import type { components } from "./api/schema";
import {
  OpenPostQueryError,
  publicationRefreshKeys,
  queryKeys,
  type PublicationRefreshRequest,
} from "./query-policy";
import { querySessionIsCurrent, type WorkspaceQueryScope } from "./query-session";

export type Publication = components["schemas"]["PublicationResponse"];

export type CachedPublication = {
  data: Publication;
  updatedAt: number;
};

type PublicationDetailGeneration = {
  dataUpdateCount: number;
  query: object;
};

type PublicationListSeedGeneration = {
  data: Publication;
  dataUpdateCount: number;
  requestOrder: number;
};

export type PublicationListCacheContext = {
  detailGenerations: ReadonlyMap<string, PublicationDetailGeneration>;
  requestOrder: number;
};

export type PublicationDetailRequestContext = PublicationDetailGeneration | null;

const publicationListSeeds = new WeakMap<object, PublicationListSeedGeneration>();
let publicationListRequestOrder = 0;

export function capturePublicationListCacheContext(
  queryClient: QueryClient,
  workspaceId: string,
): PublicationListCacheContext {
  const detailPrefix = [...queryKeys.publications(workspaceId), "detail"] as const;
  const detailGenerations = new Map<string, PublicationDetailGeneration>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: detailPrefix })) {
    const publicationId = query.queryKey[detailPrefix.length];
    if (query.queryKey.length !== detailPrefix.length + 1 || typeof publicationId !== "string") {
      continue;
    }
    detailGenerations.set(publicationId, {
      dataUpdateCount: query.state.dataUpdateCount,
      query,
    });
  }
  publicationListRequestOrder += 1;
  return { detailGenerations, requestOrder: publicationListRequestOrder };
}

export function capturePublicationDetailRequestContext(
  queryClient: QueryClient,
  workspaceId: string,
  publicationId: string,
): PublicationDetailRequestContext {
  const query = queryClient.getQueryCache().find({
    queryKey: queryKeys.publication(workspaceId, publicationId),
    exact: true,
  });
  return query ? { dataUpdateCount: query.state.dataUpdateCount, query } : null;
}

export function requirePublicationWorkspace(
  publication: Publication,
  workspaceId: string,
): Publication {
  if (publication.workspace_id !== workspaceId) {
    throw new OpenPostQueryError("This post is not in the selected workspace", { status: 404 });
  }
  return publication;
}

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
  const validated = requirePublicationWorkspace(publication, workspaceId);
  const queryKey = queryKeys.publication(workspaceId, publication.id);
  const currentQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
  const current = currentQuery?.state.data as Publication | undefined;
  if (
    current?.workspace_id === workspaceId &&
    currentQuery &&
    cachedPublicationWins(current, validated, publication.id, currentQuery, listContext)
  ) {
    return;
  }
  queryClient.setQueryData(queryKey, validated);
  const updatedQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!updatedQuery) return;
  if (!listContext) {
    publicationListSeeds.delete(updatedQuery);
    return;
  }
  publicationListSeeds.set(updatedQuery, {
    data: updatedQuery.state.data as Publication,
    dataUpdateCount: updatedQuery.state.dataUpdateCount,
    requestOrder: listContext.requestOrder,
  });
}

function cachedPublicationWins(
  current: Publication,
  incoming: Publication,
  publicationId: string,
  currentQuery: object & { state: { dataUpdateCount: number } },
  listContext?: PublicationListCacheContext,
): boolean {
  const freshness = comparePublicationFreshness(current, incoming);
  if (freshness === "current") return true;
  if (freshness === "incoming") return false;
  if (!listContext) return true;
  const initialGeneration = listContext.detailGenerations.get(publicationId);
  if (
    initialGeneration?.query === currentQuery &&
    initialGeneration.dataUpdateCount === currentQuery.state.dataUpdateCount
  ) {
    return false;
  }
  const currentListSeed = publicationListSeeds.get(currentQuery);
  if (
    currentListSeed &&
    (currentListSeed.data === current ||
      currentListSeed.dataUpdateCount === currentQuery.state.dataUpdateCount)
  ) {
    return currentListSeed.requestOrder >= listContext.requestOrder;
  }
  if (!initialGeneration || initialGeneration.query !== currentQuery) {
    return currentQuery.state.dataUpdateCount > 0;
  }
  return true;
}

type PublicationFreshness = "current" | "incoming" | "ambiguous";

function comparePublicationFreshness(
  current: Publication,
  incoming: Publication,
): PublicationFreshness {
  if (current.revision !== incoming.revision) {
    return current.revision > incoming.revision ? "current" : "incoming";
  }
  const currentUpdatedAt = Date.parse(current.updated_at);
  const incomingUpdatedAt = Date.parse(incoming.updated_at);
  if (Number.isNaN(incomingUpdatedAt)) return "current";
  if (Number.isNaN(currentUpdatedAt)) return "incoming";
  if (currentUpdatedAt === incomingUpdatedAt) return "ambiguous";
  return currentUpdatedAt > incomingUpdatedAt ? "current" : "incoming";
}

export function reconcilePublicationDetailResponse(
  queryClient: QueryClient,
  workspaceId: string,
  publication: Publication,
  requestContext: PublicationDetailRequestContext,
): Publication {
  const incoming = requirePublicationWorkspace(publication, workspaceId);
  const queryKey = queryKeys.publication(workspaceId, publication.id);
  const currentQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
  const current = currentQuery?.state.data as Publication | undefined;
  if (!currentQuery || current?.workspace_id !== workspaceId) return incoming;

  const freshness = comparePublicationFreshness(current, incoming);
  if (freshness === "current") return current;
  if (freshness === "incoming") return incoming;
  if (
    !requestContext ||
    requestContext.query !== currentQuery ||
    requestContext.dataUpdateCount !== currentQuery.state.dataUpdateCount
  ) {
    return current;
  }
  return incoming;
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
