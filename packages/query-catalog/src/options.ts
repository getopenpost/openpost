import type { QueryFunctionContext } from "@tanstack/query-core";
import type { OpenPostQueryAPI } from "./api";
import { seedPublicationDetail } from "./cache";
import { openPostQueryKeys, type ActivityPublicationBucket, type QueryPage } from "./keys";
import {
  capabilityStaleTime,
  queryGarbageCollectionTime,
  queryRetryDelay,
  queryStaleTime,
} from "./policies";
import { shouldRetryQuery } from "./errors";

function queryPolicy(staleTime: number) {
  return {
    staleTime,
    gcTime: queryGarbageCollectionTime,
    retry: shouldRetryQuery,
    retryDelay: queryRetryDelay,
    networkMode: "online" as const,
    throwOnError: false,
  };
}

export function publicationDetailQueryOptions(
  api: Pick<OpenPostQueryAPI, "getPublication">,
  workspaceId: string,
  publicationId: string,
) {
  const queryKey = openPostQueryKeys.publications.detail(workspaceId, publicationId);
  return {
    ...queryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && publicationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getPublication(workspaceId, publicationId, signal),
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
    ...queryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: async ({ client, signal }: QueryFunctionContext<typeof queryKey>) => {
      const result = await api.listActivityPublications(
        workspaceId,
        bucket,
        normalizedPage,
        signal,
      );
      signal.throwIfAborted();
      for (const publication of result.items) {
        seedPublicationDetail(client, publication, workspaceId);
      }
      return result;
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
    ...queryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listFailedJobs(workspaceId, normalizedPage, signal),
  };
}

export function workspaceAccountsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listAccounts">,
  workspaceId: string,
) {
  const queryKey = openPostQueryKeys.accounts(workspaceId);
  return {
    ...queryPolicy(queryStaleTime),
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
    ...queryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listSocialSets(workspaceId, signal),
  };
}

export function capabilityCatalogQueryOptions(api: Pick<OpenPostQueryAPI, "getCapabilities">) {
  const queryKey = openPostQueryKeys.capabilities();
  return {
    ...queryPolicy(capabilityStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getCapabilities(signal),
  };
}
