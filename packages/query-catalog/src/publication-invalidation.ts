import type { QueryFilters } from "@tanstack/query-core";
import type { QueryCachePlan } from "./cache-plan";
import type { ActivityPublicationBucket } from "./keys";
import {
  isOpenPostActivityQueryKey,
  isOpenPostDraftActivityQueryKey,
  openPostQueryKeys,
} from "./keys";

export interface PublicationQueryInvalidationEntry {
  readonly workspaceId: string;
  readonly scopes: readonly string[];
  /**
   * Exact activity buckets to invalidate. When empty or absent, the entry
   * keeps the historical coarse behavior (whole workspace activity root).
   * Moves should carry old+new buckets; generic refreshes stay coarse.
   */
  readonly activities?: readonly ActivityPublicationBucket[];
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

  const draftWorkspaceIds = new Set(
    draftEntries.map((entry) => entry.workspaceId).filter((workspaceId) => workspaceId !== "*"),
  );
  const exactActivityBuckets = new Map<string, Set<ActivityPublicationBucket>>();
  const coarseActivityWorkspaceIds = new Set<string>();
  for (const entry of activityEntries) {
    const buckets = entry.activities ?? [];
    if (buckets.length === 0) {
      coarseActivityWorkspaceIds.add(entry.workspaceId);
      continue;
    }
    let workspaceBuckets = exactActivityBuckets.get(entry.workspaceId);
    if (!workspaceBuckets) {
      workspaceBuckets = new Set<ActivityPublicationBucket>();
      exactActivityBuckets.set(entry.workspaceId, workspaceBuckets);
    }
    for (const bucket of buckets) workspaceBuckets.add(bucket);
  }
  const invalidate: QueryFilters[] = [...coarseActivityWorkspaceIds].flatMap((workspaceId) => [
    { queryKey: openPostQueryKeys.publications.activityRoot(workspaceId) },
    { queryKey: openPostQueryKeys.jobs.failed(workspaceId) },
  ]);
  for (const [workspaceId, buckets] of exactActivityBuckets) {
    if (coarseActivityWorkspaceIds.has(workspaceId)) continue;
    for (const bucket of [...buckets].sort()) {
      invalidate.push({
        queryKey: openPostQueryKeys.publications.activityAll(workspaceId, bucket),
      });
    }
    if (buckets.has("failed")) {
      invalidate.push({ queryKey: openPostQueryKeys.jobs.failed(workspaceId) });
    }
  }
  if (draftEntries.some((entry) => entry.workspaceId === "*")) {
    invalidate.push({
      predicate: (query) => isOpenPostDraftActivityQueryKey(query.queryKey),
    });
  }
  for (const workspaceId of draftWorkspaceIds) {
    if (
      coarseActivityWorkspaceIds.has(workspaceId) ||
      exactActivityBuckets.get(workspaceId)?.has("draft")
    )
      continue;
    invalidate.push({
      queryKey: openPostQueryKeys.publications.activityAll(workspaceId, "draft"),
    });
  }
  return { invalidate };
}
