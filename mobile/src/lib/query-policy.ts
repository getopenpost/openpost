import {
  createOpenPostQueryError,
  liveQueryStaleTime,
  OpenPostQueryError,
  openPostBootstrapQueryKeys,
  openPostQueryDefaults,
  openPostQueryKeys,
  openPostQueryPolicy,
  openPostWorkspaceKey,
  publicationRefreshKeys,
  queryStaleTime,
  shouldRetryQuery,
  stableQueryStaleTime,
  type ActivityPublicationBucket,
  type PublicationRefreshRequest,
  type QueryPage,
} from "@openpost/query-catalog";

export {
  createOpenPostQueryError,
  OpenPostQueryError,
  publicationRefreshKeys,
  shouldRetryQuery,
  type PublicationRefreshRequest,
  type QueryPage,
};

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
  calendar: openPostQueryKeys.calendar.all,
  calendarRange: (workspaceId: string, from: string, before: string) =>
    openPostQueryKeys.calendar.range(
      workspaceId,
      from,
      before,
      mobileQueryDimensions.calendarLimit,
    ),
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

export function networkStateIsOnline(state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}
