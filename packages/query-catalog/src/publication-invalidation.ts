import type { QueryFilters } from "@tanstack/query-core";
import type { QueryCachePlan } from "./cache-plan";
import {
  isOpenPostActivityQueryKey,
  isOpenPostDraftActivityQueryKey,
  openPostQueryKeys,
} from "./keys";

export interface PublicationQueryInvalidationEntry {
  readonly workspaceId: string;
  readonly scopes: readonly string[];
}

export function publicationInvalidationCachePlan(
  entries: readonly PublicationQueryInvalidationEntry[],
): QueryCachePlan {
  const activityEntries = entries.filter((entry) => entry.scopes.includes("activity"));
  const draftEntries = entries.filter((entry) => entry.scopes.includes("drafts"));
  if (activityEntries.length === 0 && draftEntries.length === 0) return { invalidate: [] };

  if (activityEntries.some((entry) => entry.workspaceId === "*")) {
    return {
      invalidate: [{ predicate: (query) => isOpenPostActivityQueryKey(query.queryKey) }],
    };
  }

  const activityWorkspaceIds = new Set(activityEntries.map((entry) => entry.workspaceId));
  const draftWorkspaceIds = new Set(
    draftEntries
      .map((entry) => entry.workspaceId)
      .filter((workspaceId) => workspaceId !== "*" && !activityWorkspaceIds.has(workspaceId)),
  );
  const invalidate: QueryFilters[] = [...activityWorkspaceIds].flatMap((workspaceId) => [
    { queryKey: openPostQueryKeys.publications.activityRoot(workspaceId) },
    { queryKey: openPostQueryKeys.jobs.failed(workspaceId) },
  ]);
  if (draftEntries.some((entry) => entry.workspaceId === "*")) {
    invalidate.push({
      predicate: (query) => isOpenPostDraftActivityQueryKey(query.queryKey),
    });
  }
  for (const workspaceId of draftWorkspaceIds) {
    invalidate.push({
      queryKey: openPostQueryKeys.publications.activityAll(workspaceId, "draft"),
    });
  }
  return { invalidate };
}
