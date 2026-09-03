import { InfiniteQueryObserver, QueryClient, type InfiniteData } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  accountFeaturesQueryOptions,
  analyticsOverviewQueryOptions,
  analyticsQueryKeys,
  engagementQueryOptions,
  featureQueryKeys,
  inboxPublicationsQueryOptions,
  inboxQueryKeys,
  isNotificationInboxQueryKey,
  liveQueryStaleTime,
  notificationInboxQueryOptions,
  notificationQueryKeys,
  openPostQueryDefaults,
  openPostQueryKeys,
  queryStaleTime,
  type EngagementPage,
  type InboxPublication,
  type NormalizedEngagementFilters,
} from "./index";

describe("engagement query catalogue", () => {
  it("partitions every remote view by Workspace and normalized result parameters", () => {
    expect(
      analyticsQueryKeys.overview("workspace-1", {
        days: 30,
        accountId: " account-1 ",
      }),
    ).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "analytics",
      "overview",
      {
        days: 30,
        accountId: "account-1",
        source: "all",
        sort: "engagement",
        limit: 50,
      },
    ]);
    expect(featureQueryKeys.accountStates("workspace-1", ["account-2", "account-1"])).toEqual(
      featureQueryKeys.accountStates("workspace-1", ["account-1", "account-2", "account-1"]),
    );
    expect(featureQueryKeys.accountStates("workspace-1", ["account-1"]).slice(0, -1)).toEqual(
      featureQueryKeys.all("workspace-1"),
    );
    expect(
      inboxQueryKeys.engagement("workspace-1", { unreadOnly: true, platform: "x" }),
    ).not.toEqual(inboxQueryKeys.engagement("workspace-2", { unreadOnly: true, platform: "x" }));
    expect(inboxQueryKeys.messages("workspace-1", "conversation-1", {})).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "messages",
      "conversation",
      "conversation-1",
      { limit: 200 },
    ]);
  });

  it("uses named live policy only for inboxes and live growth state", () => {
    const engagement = engagementQueryOptions({ listEngagement: vi.fn() }, "workspace-1", {});
    const notifications = notificationInboxQueryOptions(
      { listNotifications: vi.fn() },
      "workspace-1",
    );
    const analytics = analyticsOverviewQueryOptions(
      { getAnalyticsOverview: vi.fn() },
      "workspace-1",
      { days: 30 },
    );
    const features = accountFeaturesQueryOptions({ listAccountFeatures: vi.fn() }, "workspace-1", [
      "account-1",
    ]);

    expect(engagement).toMatchObject({
      staleTime: liveQueryStaleTime,
      refetchOnWindowFocus: true,
    });
    expect(notifications).toMatchObject({
      staleTime: liveQueryStaleTime,
      refetchOnWindowFocus: true,
    });
    expect(analytics).toMatchObject({
      staleTime: queryStaleTime,
      refetchOnWindowFocus: false,
    });
    expect(features).toMatchObject({
      staleTime: queryStaleTime,
      refetchOnWindowFocus: false,
    });
  });

  it("seeds publication detail from inbox search without another detail read", async () => {
    const publication = {
      id: "publication-1",
      workspace_id: "workspace-1",
    } as InboxPublication;
    const listPublications = vi.fn(async () => ({
      items: [publication],
      nextCursor: "",
    }));
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });

    await queryClient.fetchInfiniteQuery(
      inboxPublicationsQueryOptions({ listPublications }, "workspace-1", { limit: 50 }),
    );

    expect(
      queryClient.getQueryData(
        openPostQueryKeys.publications.detail("workspace-1", "publication-1"),
      ),
    ).toBe(publication);
    expect(listPublications).toHaveBeenCalledWith(
      "workspace-1",
      { search: "", limit: 50 },
      "",
      expect.any(AbortSignal),
    );
  });

  it("recognizes only Workspace notification inbox keys", () => {
    expect(isNotificationInboxQueryKey(notificationQueryKeys.inbox("workspace-1", 30))).toBe(true);
    expect(isNotificationInboxQueryKey(notificationQueryKeys.preferences())).toBe(false);
    expect(isNotificationInboxQueryKey(["openpost", "v1", "notifications", "inbox"])).toBe(false);
  });

  it("reuses a fresh engagement view without crossing Workspace boundaries", async () => {
    const listEngagement = vi.fn(
      async (
        workspaceId: string,
        _filters: NormalizedEngagementFilters,
        _cursor: string,
        _signal: AbortSignal,
      ) =>
        ({
          items: [],
          sync_states: [],
          total: workspaceId === "workspace-1" ? 1 : 2,
          next_cursor: "",
        }) as EngagementPage,
    );
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const firstWorkspace = engagementQueryOptions({ listEngagement }, "workspace-1", {
      unreadOnly: true,
    });

    await queryClient.fetchInfiniteQuery(firstWorkspace);
    await queryClient.fetchInfiniteQuery(firstWorkspace);
    await queryClient.fetchInfiniteQuery(
      engagementQueryOptions({ listEngagement }, "workspace-2", { unreadOnly: true }),
    );

    expect(listEngagement).toHaveBeenCalledTimes(2);
  });

  it("aborts and discards an active engagement request when its Workspace changes", async () => {
    let staleSignal: AbortSignal | undefined;
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    const stalePage = {
      items: [{ id: "stale-engagement" }],
      sync_states: [],
      total: 1,
      next_cursor: "",
    } as unknown as EngagementPage;
    const currentPage = {
      items: [{ id: "current-engagement" }],
      sync_states: [],
      total: 1,
      next_cursor: "",
    } as unknown as EngagementPage;
    const listEngagement = vi.fn(
      (
        workspaceId: string,
        _filters: NormalizedEngagementFilters,
        _cursor: string,
        signal: AbortSignal,
      ) => {
        if (workspaceId === "workspace-2") return Promise.resolve(currentPage);
        return new Promise<EngagementPage>((resolve) => {
          staleSignal = signal;
          signal.addEventListener(
            "abort",
            () => {
              resolveAbort();
              resolve(stalePage);
            },
            { once: true },
          );
        });
      },
    );
    const queryClient = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const firstOptions = engagementQueryOptions({ listEngagement }, "workspace-1", {});
    type EngagementKey = ReturnType<typeof inboxQueryKeys.engagement>;
    const observer = new InfiniteQueryObserver<
      EngagementPage,
      Error,
      InfiniteData<EngagementPage, string>,
      EngagementKey,
      string
    >(queryClient, firstOptions);
    const appliedIDs: string[] = [];
    const unsubscribe = observer.subscribe((result) => {
      for (const page of result.data?.pages ?? []) {
        for (const item of page.items ?? []) appliedIDs.push(item.id);
      }
    });

    await vi.waitFor(() => expect(staleSignal).toBeDefined());
    observer.setOptions(engagementQueryOptions({ listEngagement }, "workspace-2", {}));
    await aborted;
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.pages[0]).toBe(currentPage));

    expect(staleSignal?.aborted).toBe(true);
    expect(appliedIDs).not.toContain("stale-engagement");
    unsubscribe();
  });
});
