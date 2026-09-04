import type { QueryFunctionContext } from "@tanstack/query-core";
import type {
  Job,
  OpenPostQueryAPI,
  Publication,
  PublicationCalendarRange,
  QueryPageResult,
} from "./api";
import { openPostBootstrapQueryKeys } from "./bootstrap";
import {
  capturePublicationDetailRequestContext,
  capturePublicationListCacheContext,
  reconcilePublicationDetailResponse,
  seedPublicationDetail,
} from "./cache";
import { openPostQueryKeys, type ActivityPublicationBucket, type QueryPage } from "./keys";
import {
  capabilityStaleTime,
  liveQueryStaleTime,
  openPostQueryPolicy,
  queryStaleTime,
} from "./policies";

export type PublicationDetailFreshness = "standard" | "live";

export function workspaceListQueryOptions(api: Pick<OpenPostQueryAPI, "listWorkspaces">) {
  const queryKey = openPostBootstrapQueryKeys.workspaces();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listWorkspaces(signal),
  };
}

export function publicationDetailQueryOptions(
  api: Pick<OpenPostQueryAPI, "getPublication">,
  workspaceId: string,
  publicationId: string,
  freshness: PublicationDetailFreshness = "standard",
) {
  const queryKey = openPostQueryKeys.publications.detail(workspaceId, publicationId);
  return {
    ...openPostQueryPolicy(freshness === "live" ? liveQueryStaleTime : queryStaleTime),
    refetchOnWindowFocus: freshness === "live",
    queryKey,
    enabled: Boolean(workspaceId && publicationId),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const requestContext = capturePublicationDetailRequestContext(
        client,
        workspaceId,
        publicationId,
      );
      const publication = await api.getPublication(workspaceId, publicationId, signal);
      signal.throwIfAborted();
      return reconcilePublicationDetailResponse(client, workspaceId, publication, requestContext);
    },
  };
}

export function activityPublicationsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listActivityPublications">,
  workspaceId: string,
  bucket: ActivityPublicationBucket,
  page: QueryPage,
) {
  const normalizedPage = { limit: page.limit, cursor: page.cursor ?? "" };
  const queryKey = openPostQueryKeys.publications.activity(workspaceId, bucket, normalizedPage);
  return {
    ...openPostQueryPolicy(
      bucket === "scheduled" || bucket === "failed" ? liveQueryStaleTime : queryStaleTime,
    ),
    refetchOnWindowFocus: bucket === "scheduled" || bucket === "failed",
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const listContext = capturePublicationListCacheContext(client, workspaceId);
      const result = await api.listActivityPublications(
        workspaceId,
        bucket,
        normalizedPage,
        signal,
      );
      signal.throwIfAborted();
      for (const publication of result.items) {
        seedPublicationDetail(client, publication, workspaceId, listContext);
      }
      return result;
    },
  };
}

export function activityPublicationsInfiniteQueryOptions(
  api: Pick<OpenPostQueryAPI, "listActivityPublications">,
  workspaceId: string,
  bucket: ActivityPublicationBucket,
  page: Pick<QueryPage, "limit">,
) {
  const queryKey = openPostQueryKeys.publications.activity(workspaceId, bucket, {
    limit: page.limit,
    cursor: "",
  });
  return {
    ...openPostQueryPolicy(
      bucket === "scheduled" || bucket === "failed" ? liveQueryStaleTime : queryStaleTime,
    ),
    refetchOnWindowFocus: bucket === "scheduled" || bucket === "failed",
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    queryFn: async ({
      client,
      pageParam,
      signal,
    }: QueryFunctionContext<typeof queryKey, string>) => {
      const listContext = capturePublicationListCacheContext(client, workspaceId);
      const result = await api.listActivityPublications(
        workspaceId,
        bucket,
        { limit: page.limit, cursor: pageParam },
        signal,
      );
      signal.throwIfAborted();
      for (const publication of result.items) {
        seedPublicationDetail(client, publication, workspaceId, listContext);
      }
      return result;
    },
    getNextPageParam: (lastPage: QueryPageResult<Publication>) => lastPage.nextCursor || undefined,
  };
}

export function calendarPublicationsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listCalendarPublications">,
  workspaceId: string,
  range: PublicationCalendarRange,
) {
  const queryKey = openPostQueryKeys.calendar.range(
    workspaceId,
    range.from,
    range.before,
    range.limit,
  );
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && range.from && range.before),
    refetchOnWindowFocus: true,
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const listContext = capturePublicationListCacheContext(client, workspaceId);
      const publications = await api.listCalendarPublications(workspaceId, range, signal);
      signal.throwIfAborted();
      for (const publication of publications) {
        seedPublicationDetail(client, publication, workspaceId, listContext);
      }
      return publications;
    },
  };
}

export function failedJobsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listFailedJobs">,
  workspaceId: string,
  page: QueryPage,
) {
  const normalizedPage = { limit: page.limit, cursor: page.cursor ?? "" };
  const queryKey = openPostQueryKeys.jobs.failedPage(workspaceId, normalizedPage);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    refetchOnWindowFocus: true,
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listFailedJobs(workspaceId, normalizedPage, signal),
  };
}

export function failedJobsInfiniteQueryOptions(
  api: Pick<OpenPostQueryAPI, "listFailedJobs">,
  workspaceId: string,
  page: Pick<QueryPage, "limit">,
) {
  const queryKey = openPostQueryKeys.jobs.failedPage(workspaceId, {
    limit: page.limit,
    cursor: "",
  });
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    refetchOnWindowFocus: true,
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.listFailedJobs(workspaceId, { limit: page.limit, cursor: pageParam }, signal),
    getNextPageParam: (lastPage: QueryPageResult<Job>) => lastPage.nextCursor || undefined,
  };
}

export function workspaceAccountsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listAccounts">,
  workspaceId: string,
) {
  const queryKey = openPostQueryKeys.accounts(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listAccounts(workspaceId, signal),
  };
}

export function workspaceSocialSetsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listSocialSets">,
  workspaceId: string,
) {
  const queryKey = openPostQueryKeys.socialSets(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listSocialSets(workspaceId, signal),
  };
}

export function capabilityCatalogQueryOptions(api: Pick<OpenPostQueryAPI, "getCapabilities">) {
  const queryKey = openPostQueryKeys.capabilities();
  return {
    ...openPostQueryPolicy(capabilityStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getCapabilities(signal),
  };
}
