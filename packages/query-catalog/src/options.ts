import type { QueryFunctionContext } from "@tanstack/query-core";
import type { OpenPostQueryAPI } from "./api";
import {
  capturePublicationDetailRequestContext,
  capturePublicationListCacheContext,
  reconcilePublicationDetailResponse,
  seedPublicationDetail,
} from "./cache";
import { openPostQueryKeys, type ActivityPublicationBucket, type QueryPage } from "./keys";
import { capabilityStaleTime, openPostQueryPolicy, queryStaleTime } from "./policies";

export function publicationDetailQueryOptions(
  api: Pick<OpenPostQueryAPI, "getPublication">,
  workspaceId: string,
  publicationId: string,
) {
  const queryKey = openPostQueryKeys.publications.detail(workspaceId, publicationId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
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
    ...openPostQueryPolicy(queryStaleTime),
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

export function failedJobsQueryOptions(
  api: Pick<OpenPostQueryAPI, "listFailedJobs">,
  workspaceId: string,
  page: QueryPage,
) {
  const normalizedPage = { limit: page.limit, cursor: page.cursor ?? "" };
  const queryKey = openPostQueryKeys.jobs.failedPage(workspaceId, normalizedPage);
  return {
    ...openPostQueryPolicy(queryStaleTime),
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
