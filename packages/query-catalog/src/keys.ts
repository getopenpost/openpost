export type ActivityPublicationBucket = "scheduled" | "published" | "failed" | "draft";

export interface QueryPage {
  readonly limit: number;
  readonly cursor?: string;
}

const rootKey = ["openpost", "v1"] as const;
const workspaceKey = (workspaceId: string) => [...rootKey, "workspace", workspaceId] as const;
const publicationActivityRootKey = (workspaceId: string) =>
  [...workspaceKey(workspaceId), "publications", "list", "activity"] as const;
const publicationActivityKey = (workspaceId: string, bucket: ActivityPublicationBucket) =>
  [...publicationActivityRootKey(workspaceId), bucket] as const;

export const openPostQueryKeys = {
  all: rootKey,
  capabilities: () => [...rootKey, "capabilities"] as const,
  publications: {
    all: (workspaceId: string) => [...workspaceKey(workspaceId), "publications"] as const,
    list: (workspaceId: string) => [...workspaceKey(workspaceId), "publications", "list"] as const,
    activityRoot: publicationActivityRootKey,
    activityAll: publicationActivityKey,
    activity: (workspaceId: string, bucket: ActivityPublicationBucket, page: QueryPage) =>
      [
        ...publicationActivityKey(workspaceId, bucket),
        { cursor: page.cursor ?? "", limit: page.limit },
      ] as const,
    detail: (workspaceId: string, publicationId: string) =>
      [...workspaceKey(workspaceId), "publications", "detail", publicationId] as const,
  },
  jobs: {
    failed: (workspaceId: string) => [...workspaceKey(workspaceId), "jobs", "failed"] as const,
    failedPage: (workspaceId: string, page: QueryPage) =>
      [
        ...workspaceKey(workspaceId),
        "jobs",
        "failed",
        { cursor: page.cursor ?? "", limit: page.limit },
      ] as const,
  },
  accounts: (workspaceId: string) => [...workspaceKey(workspaceId), "accounts"] as const,
  socialSets: (workspaceId: string) => [...workspaceKey(workspaceId), "social-sets"] as const,
};

export function isOpenPostActivityQueryKey(queryKey: readonly unknown[]): boolean {
  if (
    queryKey[0] !== rootKey[0] ||
    queryKey[1] !== rootKey[1] ||
    queryKey[2] !== "workspace" ||
    typeof queryKey[3] !== "string"
  ) {
    return false;
  }

  return (
    (queryKey[4] === "publications" && queryKey[5] === "list" && queryKey[6] === "activity") ||
    (queryKey[4] === "jobs" && queryKey[5] === "failed")
  );
}

export function isOpenPostDraftActivityQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    isOpenPostActivityQueryKey(queryKey) &&
    queryKey[4] === "publications" &&
    queryKey[7] === "draft"
  );
}
