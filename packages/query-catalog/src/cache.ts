import type { QueryClient } from "@tanstack/query-core";
import type { Publication } from "./api";
import { OpenPostQueryError } from "./errors";
import { openPostQueryKeys } from "./keys";

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
  client: QueryClient,
  workspaceId: string,
): PublicationListCacheContext {
  const detailPrefix = openPostQueryKeys.publications.detail(workspaceId, "").slice(0, -1);
  const detailGenerations = new Map<string, PublicationDetailGeneration>();
  for (const query of client.getQueryCache().findAll({ queryKey: detailPrefix })) {
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
  client: QueryClient,
  workspaceId: string,
  publicationId: string,
): PublicationDetailRequestContext {
  const query = client.getQueryCache().find({
    queryKey: openPostQueryKeys.publications.detail(workspaceId, publicationId),
    exact: true,
  });
  return query ? { dataUpdateCount: query.state.dataUpdateCount, query } : null;
}

export function requirePublicationWorkspace(
  publication: Publication,
  expectedWorkspaceId: string,
): Publication {
  if (publication.workspace_id !== expectedWorkspaceId) {
    throw new OpenPostQueryError("This post is not in the selected workspace", { status: 404 });
  }
  return publication;
}

export function seedPublicationDetail(
  client: QueryClient,
  publication: Publication,
  expectedWorkspaceId = publication.workspace_id,
  listContext?: PublicationListCacheContext,
): Publication {
  const incoming = requirePublicationWorkspace(publication, expectedWorkspaceId);
  const queryKey = openPostQueryKeys.publications.detail(expectedWorkspaceId, publication.id);
  const currentQuery = client.getQueryCache().find({ queryKey, exact: true });
  const current = currentQuery?.state.data as Publication | undefined;
  if (
    current?.workspace_id === expectedWorkspaceId &&
    currentQuery &&
    cachedPublicationWins(current, incoming, publication.id, currentQuery, listContext)
  ) {
    return publication;
  }
  client.setQueryData(queryKey, incoming);
  const updatedQuery = client.getQueryCache().find({ queryKey, exact: true });
  if (!updatedQuery) return publication;
  if (!listContext) {
    publicationListSeeds.delete(updatedQuery);
    return publication;
  }
  publicationListSeeds.set(updatedQuery, {
    data: updatedQuery.state.data as Publication,
    dataUpdateCount: updatedQuery.state.dataUpdateCount,
    requestOrder: listContext.requestOrder,
  });
  return publication;
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
  client: QueryClient,
  workspaceId: string,
  publication: Publication,
  requestContext: PublicationDetailRequestContext,
): Publication {
  const incoming = requirePublicationWorkspace(publication, workspaceId);
  const queryKey = openPostQueryKeys.publications.detail(workspaceId, publication.id);
  const currentQuery = client.getQueryCache().find({ queryKey, exact: true });
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
