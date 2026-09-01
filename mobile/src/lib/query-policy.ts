import {
  createOpenPostQueryError,
  liveQueryStaleTime,
  OpenPostQueryError,
  openPostBootstrapQueryKeys,
  openPostQueryDefaults,
  openPostQueryKeys,
  openPostQueryPolicy,
  openPostWorkspaceKey,
  queryStaleTime,
  shouldRetryQuery,
  stableQueryStaleTime,
  type ActivityPublicationBucket,
  type QueryPage,
} from "@openpost/query-catalog";

export { createOpenPostQueryError, OpenPostQueryError, shouldRetryQuery, type QueryPage };

export type PublicationActivity = ActivityPublicationBucket;
export type PublicationFreshness = "standard" | "live";

export const mobileQueryDimensions = {
  publicationPage: { limit: 100 },
  calendarLimit: 200,
} as const;

export const queryKeys = {
  workspaces: openPostBootstrapQueryKeys.workspaces,
  workspace: openPostWorkspaceKey,
  publications: openPostQueryKeys.publications.all,
  publicationLists: openPostQueryKeys.publications.list,
  publicationActivity: (
    workspaceId: string,
    activity: PublicationActivity,
    page: QueryPage = mobileQueryDimensions.publicationPage,
  ) => openPostQueryKeys.publications.activity(workspaceId, activity, page),
  calendar: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "calendar"),
  calendarRange: (workspaceId: string, from: string, before: string) =>
    [
      ...openPostWorkspaceKey(workspaceId, "calendar"),
      "range",
      { before, from, limit: mobileQueryDimensions.calendarLimit },
    ] as const,
  publication: openPostQueryKeys.publications.detail,
  accounts: openPostQueryKeys.accounts,
  socialSets: openPostQueryKeys.socialSets,
};

export const queryPolicies = {
  standard: openPostQueryPolicy(queryStaleTime),
  reference: openPostQueryPolicy(stableQueryStaleTime),
  live: {
    ...openPostQueryPolicy(liveQueryStaleTime),
    refetchOnWindowFocus: true,
  },
  mutations: openPostQueryDefaults.mutations,
};

export function publicationQueryPolicy(freshness: PublicationFreshness) {
  return queryPolicies[freshness];
}

export type PublicationRefreshRequest = {
  workspaceId: string;
  publicationId?: string;
  activities?: readonly PublicationActivity[];
  calendar?: boolean;
};

export type PublicationRefreshKey = {
  queryKey: readonly unknown[];
  exact?: true;
};

export function publicationRefreshKeys({
  workspaceId,
  publicationId,
  activities = [],
  calendar = false,
}: PublicationRefreshRequest): PublicationRefreshKey[] {
  const keys: PublicationRefreshKey[] = [];
  if (publicationId) {
    keys.push({
      queryKey: openPostQueryKeys.publications.detail(workspaceId, publicationId),
      exact: true,
    });
  }
  for (const activity of new Set(activities)) {
    keys.push({
      queryKey: openPostQueryKeys.publications.activity(
        workspaceId,
        activity,
        mobileQueryDimensions.publicationPage,
      ),
      exact: true,
    });
  }
  if (calendar) keys.push({ queryKey: queryKeys.calendar(workspaceId) });
  return keys;
}

export function networkStateIsOnline(state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}
