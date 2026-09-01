import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { api } from "./api/client";
import { getWorkspaceId, subscribeWorkspaceId } from "./api/token-store";
import {
  capturePublicationDetailRequestContext,
  capturePublicationListCacheContext,
  findCachedPublication,
  cachePublicationDetails,
  reconcilePublicationDetailResponse,
  requirePublicationWorkspace,
  type Publication,
} from "./query-cache";
import {
  createOpenPostQueryError,
  mobileQueryDimensions,
  publicationQueryPolicy,
  queryKeys,
  queryPolicies,
  type PublicationActivity,
  type PublicationFreshness,
} from "./query-policy";
import { captureWorkspaceQueryScope, querySessionIsCurrent } from "./query-session";

export type WorkspaceSummary = {
  id: string;
  name?: string | null;
};

export type PublicationListItem = Publication;

export type AccountSummary = {
  id: string;
  platform: string;
  slug?: string | null;
  account_username?: string | null;
  is_active: boolean;
};

export type SocialSetSummary = {
  id: string;
  name?: string | null;
  is_default?: boolean | null;
  accounts?: { social_account_id: string }[] | null;
};

export function workspacesOptions() {
  return queryOptions({
    ...queryPolicies.reference,
    queryKey: queryKeys.workspaces(),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api().GET("/workspaces", { signal });
      if (error || !data) {
        throw createOpenPostQueryError(response?.status, error, "Could not load workspaces");
      }
      return data
        .filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace))
        .map((workspace) => ({ id: workspace.id, name: workspace.name }));
    },
  });
}

export function publicationActivityOptions(
  queryClient: QueryClient,
  workspaceId: string,
  activity: PublicationActivity,
) {
  const policy =
    activity === "scheduled" || activity === "failed" ? queryPolicies.live : queryPolicies.standard;
  return queryOptions({
    ...policy,
    queryKey: queryKeys.publicationActivity(workspaceId, activity),
    queryFn: async ({ signal }) => {
      const scope = captureWorkspaceQueryScope(workspaceId);
      const listContext = capturePublicationListCacheContext(queryClient, workspaceId);
      const { data, error, response } = await api().GET("/publications", {
        signal,
        params: {
          query: {
            workspace_id: workspaceId,
            activity_bucket: activity,
            limit: mobileQueryDimensions.publicationPage.limit,
          },
        },
      });
      if (error || !data) {
        throw createOpenPostQueryError(response?.status, error, "Could not load posts");
      }
      return cachePublicationDetails(queryClient, scope, data, listContext);
    },
  });
}

export function calendarOptions(
  queryClient: QueryClient,
  workspaceId: string,
  from: string,
  before: string,
) {
  return queryOptions({
    ...queryPolicies.live,
    queryKey: queryKeys.calendarRange(workspaceId, from, before),
    queryFn: async ({ signal }) => {
      const scope = captureWorkspaceQueryScope(workspaceId);
      const listContext = capturePublicationListCacheContext(queryClient, workspaceId);
      const { data, error, response } = await api().GET("/publications", {
        signal,
        params: {
          query: {
            workspace_id: workspaceId,
            calendar_from: from,
            calendar_before: before,
            limit: mobileQueryDimensions.calendarLimit,
          },
        },
      });
      if (error || !data) {
        throw createOpenPostQueryError(response?.status, error, "Could not load calendar");
      }
      return cachePublicationDetails(queryClient, scope, data, listContext);
    },
  });
}

export function publicationOptions(
  queryClient: QueryClient,
  workspaceId: string,
  publicationId: string,
  freshness: PublicationFreshness = "standard",
) {
  const cached = () => findCachedPublication(queryClient, workspaceId, publicationId);
  return queryOptions({
    ...publicationQueryPolicy(freshness),
    queryKey: queryKeys.publication(workspaceId, publicationId),
    queryFn: async ({ signal }) => {
      const scope = captureWorkspaceQueryScope(workspaceId);
      const requestContext = capturePublicationDetailRequestContext(
        queryClient,
        workspaceId,
        publicationId,
      );
      const { data, error, response } = await api().GET("/publications/{id}", {
        signal,
        params: { path: { id: publicationId } },
      });
      if (error || !data) {
        throw createOpenPostQueryError(response?.status, error, "Could not load post");
      }
      const publication = requirePublicationWorkspace(data, workspaceId);
      if (!querySessionIsCurrent(scope)) return publication;
      return reconcilePublicationDetailResponse(
        queryClient,
        workspaceId,
        publication,
        requestContext,
      );
    },
    initialData: () => cached()?.data,
    initialDataUpdatedAt: () => cached()?.updatedAt,
  });
}

export function accountsOptions(workspaceId: string) {
  return queryOptions({
    ...queryPolicies.reference,
    queryKey: queryKeys.accounts(workspaceId),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api().GET("/accounts", {
        signal,
        params: { query: { workspace_id: workspaceId } },
      });
      if (error || !data) {
        throw createOpenPostQueryError(response?.status, error, "Could not load accounts");
      }
      return data
        .filter((account) => Boolean(account && account.is_active))
        .map((account) => ({
          id: account.id,
          platform: account.platform,
          slug: account.slug,
          account_username: account.account_username,
          is_active: true,
        }));
    },
  });
}

export function socialSetsOptions(workspaceId: string) {
  return queryOptions({
    ...queryPolicies.reference,
    queryKey: queryKeys.socialSets(workspaceId),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api().GET("/social-sets", {
        signal,
        params: { query: { workspace_id: workspaceId } },
      });
      if (error || !data) {
        throw createOpenPostQueryError(response?.status, error, "Could not load social sets");
      }
      return data
        .filter((socialSet): socialSet is NonNullable<typeof socialSet> => Boolean(socialSet))
        .map((socialSet) => ({
          id: socialSet.id,
          name: socialSet.name,
          is_default: socialSet.is_default,
          accounts: socialSet.accounts,
        }));
    },
  });
}

export function useWorkspaces() {
  return useQuery(workspacesOptions());
}

export function usePublications(activity: PublicationActivity) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...publicationActivityOptions(queryClient, workspaceId ?? "", activity),
    enabled: Boolean(workspaceId),
  });
}

export function useCalendarPublications(from: string, before: string) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...calendarOptions(queryClient, workspaceId ?? "", from, before),
    enabled: Boolean(workspaceId),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[3] === workspaceId ? previousData : undefined,
  });
}

export function usePublication(
  publicationId: string,
  freshness: PublicationFreshness = "standard",
) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...publicationOptions(queryClient, workspaceId ?? "", publicationId, freshness),
    enabled: Boolean(workspaceId && publicationId),
  });
}

export function useAccounts(enabled = true) {
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...accountsOptions(workspaceId ?? ""),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useSocialSets(enabled = true) {
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...socialSetsOptions(workspaceId ?? ""),
    enabled: enabled && Boolean(workspaceId),
  });
}

export async function prefetchPublicationEditor(
  queryClient: QueryClient,
  workspaceId: string,
  publicationId: string,
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery(publicationOptions(queryClient, workspaceId, publicationId)),
    queryClient.prefetchQuery(accountsOptions(workspaceId)),
    queryClient.prefetchQuery(socialSetsOptions(workspaceId)),
  ]);
}

export function currentWorkspaceId(): string {
  const id = getWorkspaceId();
  if (!id) throw new Error("No workspace selected");
  return id;
}

export function useWorkspaceId(): string | null {
  return useSyncExternalStore(subscribeWorkspaceId, getWorkspaceId);
}
