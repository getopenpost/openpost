import {
  activityPublicationsQueryOptions,
  analyticsOverviewQueryOptions,
  type AnalyticsFilters,
  calendarPublicationsQueryOptions,
  failedJobsQueryOptions,
  publicationDetailQueryOptions,
  workspaceAccountsQueryOptions,
  workspaceListQueryOptions,
  workspaceSetupQueryOptions,
  workspaceSocialSetsQueryOptions,
  type SocialAccount,
  type Workspace,
} from "@openpost/query-catalog";
import {
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { getWorkspaceId, subscribeWorkspaceId } from "./api/token-store";
import { findCachedPublication, type Publication } from "./query-cache";
import { mobileQueryAPI } from "./query-api";
import {
  mobileQueryDimensions,
  type PublicationActivity,
  type PublicationFreshness,
} from "./query-policy";

export type PublicationListItem = Publication;

export function useAnalytics(filters: AnalyticsFilters) {
  const workspaceId = useWorkspaceId();
  return useInfiniteQuery(
    analyticsOverviewQueryOptions(mobileQueryAPI, workspaceId ?? "", filters),
  );
}

export type MobileWorkspace = Pick<Workspace, "id" | "name" | "avatar_url" | "color">;

export type MobileAccount = Pick<
  SocialAccount,
  | "id"
  | "platform"
  | "slug"
  | "account_username"
  | "alias"
  | "account_avatar_url"
  | "instance_url"
  | "is_active"
>;

export function workspacesOptions() {
  return queryOptions({
    ...workspaceListQueryOptions(mobileQueryAPI),
    select: (data): MobileWorkspace[] =>
      data
        .filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace))
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          avatar_url: workspace.avatar_url,
          color: workspace.color,
        })),
  });
}

export function publicationActivityOptions(workspaceId: string, activity: PublicationActivity) {
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

export function calendarOptions(workspaceId: string, from: string, before: string) {
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
  // GET /accounts already returns only is_active rows server-side, so there is
  // no client-side filter here. is_active is passed through (not hardcoded)
  // because the onboarding gate in lib/first-use.ts routes on it.
  return queryOptions({
    ...workspaceAccountsQueryOptions(mobileQueryAPI, workspaceId),
    select: (data): MobileAccount[] =>
      data
        .filter((account): account is NonNullable<typeof account> => Boolean(account))
        .map((account) => ({
          id: account.id,
          platform: account.platform,
          slug: account.slug,
          account_username: account.account_username,
          alias: account.alias,
          account_avatar_url: account.account_avatar_url,
          instance_url: account.instance_url,
          is_active: account.is_active,
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
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...publicationActivityOptions(workspaceId ?? "", activity),
    enabled: Boolean(workspaceId),
  });
}

export function useCalendarPublications(from: string, before: string) {
  const workspaceId = useWorkspaceId();
  return useQuery({
    ...calendarOptions(workspaceId ?? "", from, before),
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

export function useFailedJobs(limit: number) {
  const workspaceId = useWorkspaceId();
  return useQuery(failedJobsQueryOptions(mobileQueryAPI, workspaceId ?? "", { limit }));
}

export function useWorkspaceSetup() {
  const workspaceId = useWorkspaceId();
  return useQuery(workspaceSetupQueryOptions(mobileQueryAPI, workspaceId ?? ""));
}

export function useDisconnectedAccounts() {
  const accounts = useAccounts();
  return (accounts.data ?? []).filter((account) => !account.is_active).length;
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

export function useWorkspaceCapabilities() {
  const workspaceId = useWorkspaceId();
  const workspaces = useQuery(workspaceListQueryOptions(mobileQueryAPI));
  return workspaces.data?.find((workspace) => workspace.id === workspaceId);
}
