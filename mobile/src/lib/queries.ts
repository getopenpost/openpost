import {
  activityPublicationsQueryOptions,
  calendarPublicationsQueryOptions,
  publicationDetailQueryOptions,
  workspaceAccountsQueryOptions,
  workspaceListQueryOptions,
  workspaceSocialSetsQueryOptions,
} from "@openpost/query-catalog";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { getWorkspaceId, subscribeWorkspaceId } from "./api/token-store";
import { findCachedPublication, type Publication } from "./query-cache";
import { mobileQueryAPI } from "./query-api";
import {
  mobileQueryDimensions,
  type PublicationActivity,
  type PublicationFreshness,
} from "./query-policy";

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
    ...workspaceListQueryOptions(mobileQueryAPI),
    select: (data) =>
      data
        .filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace))
        .map((workspace) => ({ id: workspace.id, name: workspace.name })),
  });
}

export function publicationActivityOptions(
  _queryClient: QueryClient,
  workspaceId: string,
  activity: PublicationActivity,
) {
  return queryOptions({
    ...activityPublicationsQueryOptions(
      mobileQueryAPI,
      workspaceId,
      activity,
      mobileQueryDimensions.publicationPage,
    ),
    select: (page) => page.items,
  });
}

export function calendarOptions(
  _queryClient: QueryClient,
  workspaceId: string,
  from: string,
  before: string,
) {
  return queryOptions({
    ...calendarPublicationsQueryOptions(mobileQueryAPI, workspaceId, {
      from,
      before,
      limit: mobileQueryDimensions.calendarLimit,
    }),
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
    ...publicationDetailQueryOptions(mobileQueryAPI, workspaceId, publicationId, freshness),
    initialData: () => cached()?.data,
    initialDataUpdatedAt: () => cached()?.updatedAt,
  });
}

export function accountsOptions(workspaceId: string) {
  return queryOptions({
    ...workspaceAccountsQueryOptions(mobileQueryAPI, workspaceId),
    select: (data) =>
      data
        .filter((account) => Boolean(account && account.is_active))
        .map((account) => ({
          id: account.id,
          platform: account.platform,
          slug: account.slug,
          account_username: account.account_username,
          is_active: true,
        })),
  });
}

export function socialSetsOptions(workspaceId: string) {
  return queryOptions({
    ...workspaceSocialSetsQueryOptions(mobileQueryAPI, workspaceId),
    select: (data) =>
      data
        .filter((socialSet): socialSet is NonNullable<typeof socialSet> => Boolean(socialSet))
        .map((socialSet) => ({
          id: socialSet.id,
          name: socialSet.name,
          is_default: socialSet.is_default,
          accounts: socialSet.accounts,
        })),
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
