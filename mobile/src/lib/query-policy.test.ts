import { describe, expect, test } from "bun:test";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  capturePublicationListCacheContext,
  cacheCreatedPublication,
  cachePublicationDetails,
  findCachedPublication,
  invalidatePublicationData,
  requirePublicationWorkspace,
  type Publication,
} from "./query-cache";
import {
  createOpenPostQueryError,
  networkStateIsOnline,
  OpenPostQueryError,
  publicationQueryPolicy,
  publicationRefreshKeys,
  queryKeys,
  queryPolicies,
  shouldRetryQuery,
} from "./query-policy";
import {
  captureWorkspaceQueryScope,
  getQueryActorRevision,
  markQueryActorChanged,
  markQuerySessionChanged,
  queryActorScopeIsCurrent,
  querySessionIsCurrent,
  requireCurrentQueryActor,
  requireCurrentQuerySession,
  subscribeQueryActor,
  workspaceQueryScopeIsCurrent,
} from "./query-session";

describe("mobile query keys", () => {
  test("keeps workspace data and request dimensions in canonical keys", () => {
    expect(queryKeys.workspaces()).toEqual(["openpost", "v1", "workspaces"]);
    expect(queryKeys.publicationActivity("workspace-1", "draft")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "publications",
      "list",
      "activity",
      "draft",
      { cursor: "", limit: 100 },
    ]);
    expect(queryKeys.calendarRange("workspace-1", "2026-09-01", "2026-10-01")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "calendar",
      "range",
      { before: "2026-10-01", from: "2026-09-01", limit: 200 },
    ]);
    expect(queryKeys.publication("workspace-1", "publication-1")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "publications",
      "detail",
      "publication-1",
    ]);
    expect(queryKeys.accounts("workspace-1")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "accounts",
    ]);
    expect(queryKeys.socialSets("workspace-1")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "social-sets",
    ]);
  });

  test("refreshes only the publication records named by a mutation", () => {
    expect(
      publicationRefreshKeys({
        workspaceId: "workspace-1",
        publicationId: "publication-1",
        activities: ["draft", "scheduled"],
        calendar: true,
      }),
    ).toEqual([
      {
        queryKey: [
          "openpost",
          "v1",
          "workspace",
          "workspace-1",
          "publications",
          "detail",
          "publication-1",
        ],
        exact: true,
      },
      {
        queryKey: [
          "openpost",
          "v1",
          "workspace",
          "workspace-1",
          "publications",
          "list",
          "activity",
          "draft",
        ],
      },
      {
        queryKey: [
          "openpost",
          "v1",
          "workspace",
          "workspace-1",
          "publications",
          "list",
          "activity",
          "scheduled",
        ],
      },
      {
        queryKey: ["openpost", "v1", "workspace", "workspace-1", "calendar"],
      },
    ]);
  });
});

describe("mobile query policy", () => {
  test("runs consequential mutations once instead of queuing them for reconnect", async () => {
    expect(queryPolicies.mutations).toEqual({
      networkMode: "always",
      retry: false,
      throwOnError: false,
    });

    const client = new QueryClient({ defaultOptions: { mutations: queryPolicies.mutations } });
    let calls = 0;
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        calls += 1;
      },
    });
    onlineManager.setOnline(false);
    const execution = mutation.execute(undefined);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mutation.state.isPaused).toBe(false);
      expect(calls).toBe(1);
    } finally {
      onlineManager.setOnline(true);
      await execution;
      client.clear();
    }
  });

  test("uses explicit ordinary, reference, and live freshness", () => {
    expect(queryPolicies.standard.staleTime).toBe(30_000);
    expect(queryPolicies.reference.staleTime).toBe(300_000);
    expect(queryPolicies.live.staleTime).toBe(15_000);
    expect(queryPolicies.standard.refetchOnWindowFocus).toBe(false);
    expect(queryPolicies.live.refetchOnWindowFocus).toBe(true);
  });

  test("opts only named publication detail reads into live refresh", () => {
    const standard = publicationQueryPolicy("standard");
    const live = publicationQueryPolicy("live");

    expect(standard.staleTime).toBe(30_000);
    expect(standard.refetchOnWindowFocus).toBe(false);
    expect(live.staleTime).toBe(15_000);
    expect(live.refetchOnWindowFocus).toBe(true);
  });

  test("retries one transient read but not cancelled or ordinary client failures", () => {
    expect(shouldRetryQuery(0, new TypeError("Network request failed"))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("timeout", { status: 408 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("early", { status: 425 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("limited", { status: 429 }))).toBe(true);
    expect(shouldRetryQuery(0, new OpenPostQueryError("busy", { status: 503 }))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError("Network request failed"))).toBe(false);
    expect(shouldRetryQuery(0, new OpenPostQueryError("invalid", { status: 400 }))).toBe(false);
    expect(shouldRetryQuery(0, new OpenPostQueryError("invalid", { status: 600 }))).toBe(false);
    expect(shouldRetryQuery(0, new Error("unexpected application error"))).toBe(false);
    expect(shouldRetryQuery(0, "unexpected application error")).toBe(false);
    expect(shouldRetryQuery(0, new DOMException("cancelled", "AbortError"))).toBe(false);
  });

  test("keeps status and server problem detail on query failures", () => {
    const problem = { detail: "  The post is no longer available.  " };
    const error = createOpenPostQueryError(404, problem, "Could not load post");

    expect(error).toBeInstanceOf(OpenPostQueryError);
    expect(error.message).toBe("The post is no longer available.");
    expect(error.detail).toBe("The post is no longer available.");
    expect(error.status).toBe(404);
    expect(error.cause).toBe(problem);

    const fallback = createOpenPostQueryError(undefined, { detail: "   " }, "Could not load post");
    expect(fallback.message).toBe("Could not load post");
    expect(fallback.detail).toBe("Could not load post");
    expect(fallback.status).toBeUndefined();
  });

  test("treats a connected network without a failed reachability check as online", () => {
    expect(networkStateIsOnline({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(networkStateIsOnline({ isConnected: true })).toBe(true);
    expect(networkStateIsOnline({ isConnected: false, isInternetReachable: false })).toBe(false);
    expect(networkStateIsOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(networkStateIsOnline({})).toBe(false);
  });
});

describe("query cache behavior", () => {
  test("deduplicates equal reads and reuses a fresh result", async () => {
    onlineManager.setOnline(true);
    const client = new QueryClient();
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const options = {
      ...queryPolicies.standard,
      queryKey: queryKeys.publicationActivity("workspace-1", "draft"),
      queryFn: async () => {
        calls += 1;
        await gate;
        return [publication("publication-1", "draft")];
      },
    };

    const first = client.fetchQuery(options);
    const second = client.fetchQuery(options);
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    await client.fetchQuery(options);

    expect(calls).toBe(1);
    client.clear();
  });

  test("does not bridge mounted observer data across Workspace keys", () => {
    const client = new QueryClient();
    const workspaceOneKey = queryKeys.publicationActivity("workspace-1", "draft");
    const workspaceTwoKey = queryKeys.publicationActivity("workspace-2", "draft");
    const cached = [publication("publication-1", "draft")];
    const queryFn = async () => cached;
    client.setQueryData(workspaceOneKey, cached);
    const observer = new QueryObserver(client, {
      ...queryPolicies.standard,
      enabled: false,
      queryKey: workspaceOneKey,
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(observer.getCurrentResult().data).toEqual(cached);
    observer.setOptions({
      ...queryPolicies.standard,
      enabled: false,
      queryKey: workspaceTwoKey,
      queryFn,
    });
    expect(observer.getCurrentResult().data).toBeUndefined();

    unsubscribe();
    client.clear();
  });

  test("cancels an observed Calendar read when navigation removes its consumer", async () => {
    onlineManager.setOnline(true);
    const client = new QueryClient();
    let requestSignal: AbortSignal | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const observer = new QueryObserver<Publication[], OpenPostQueryError>(client, {
      ...queryPolicies.live,
      queryKey: queryKeys.calendarRange("workspace-1", "2026-09-01", "2026-10-01"),
      queryFn: ({ signal }) => {
        requestSignal = signal;
        markStarted();
        return new Promise<Publication[]>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    const unsubscribe = observer.subscribe(() => undefined);
    await started;
    unsubscribe();

    expect(requestSignal?.aborted).toBe(true);
    client.clear();
  });

  test("keeps cached Calendar data visible after a background failure", async () => {
    onlineManager.setOnline(true);
    const client = new QueryClient();
    const queryKey = queryKeys.calendarRange("workspace-1", "2026-09-01", "2026-10-01");
    const cached = [publication("publication-1", "scheduled")];
    client.setQueryData(queryKey, cached, { updatedAt: 1 });
    let calls = 0;
    const observer = new QueryObserver<Publication[], OpenPostQueryError>(client, {
      ...queryPolicies.live,
      queryKey,
      queryFn: async () => {
        calls += 1;
        throw new OpenPostQueryError("forbidden", { status: 403 });
      },
    });
    let unsubscribe: () => void = () => {};
    await new Promise<void>((resolve) => {
      unsubscribe = observer.subscribe((result) => {
        if (result.isError) resolve();
      });
    });

    const result = observer.getCurrentResult();
    expect(result.data).toEqual(cached);
    expect(result.isError).toBe(true);
    expect(calls).toBe(1);
    unsubscribe();
    client.clear();
  });
});

describe("publication cache handoff", () => {
  test("cancels a draft read started during creation before seeding and refreshing", async () => {
    onlineManager.setOnline(true);
    const client = new QueryClient();
    const draftKey = queryKeys.publicationActivity("workspace-1", "draft");
    const existing = publication("publication-1", "draft");
    const created = publication("publication-2", "draft");
    let calls = 0;
    let firstRequestSignal: AbortSignal | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    client.setQueryData(draftKey, [existing], { updatedAt: 1 });
    await client.cancelQueries({ queryKey: draftKey, exact: true });
    const observer = new QueryObserver<Publication[], OpenPostQueryError>(client, {
      ...queryPolicies.standard,
      staleTime: 0,
      queryKey: draftKey,
      queryFn: ({ signal }) => {
        calls += 1;
        if (calls > 1) return Promise.resolve([created, existing]);
        firstRequestSignal = signal;
        markStarted();
        return new Promise<Publication[]>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await started;
    await client.cancelQueries({ queryKey: draftKey, exact: true });
    cacheCreatedPublication(client, "workspace-1", created);
    await invalidatePublicationData(client, {
      workspaceId: "workspace-1",
      activities: ["draft"],
    });

    expect(firstRequestSignal?.aborted).toBe(true);
    expect(calls).toBe(2);
    expect(client.getQueryData<Publication[]>(draftKey)?.map(({ id }) => id)).toEqual([
      "publication-2",
      "publication-1",
    ]);
    unsubscribe();
    client.clear();
  });

  test("makes a created draft available to its editor without replacing the full draft list", () => {
    const client = new QueryClient();
    const existing = publication("publication-1", "draft");
    const created = publication("publication-2", "draft");
    const draftKey = queryKeys.publicationActivity("workspace-1", "draft");
    client.setQueryData(draftKey, [existing]);

    cacheCreatedPublication(client, "workspace-1", created);
    cacheCreatedPublication(client, "workspace-1", created);

    expect(
      client.getQueryData<Publication>(queryKeys.publication("workspace-1", created.id)),
    ).toEqual(created);
    expect(client.getQueryData<Publication[]>(draftKey)?.map(({ id }) => id)).toEqual([
      "publication-2",
      "publication-1",
    ]);

    const emptyClient = new QueryClient();
    cacheCreatedPublication(emptyClient, "workspace-1", created);
    expect(emptyClient.getQueryData(draftKey)).toBeUndefined();
  });

  test("uses a full publication already loaded by a list as detail data", () => {
    const client = new QueryClient();
    const cached = publication("publication-1", "scheduled");
    client.setQueryData(
      queryKeys.calendarRange("workspace-1", "2026-09-01", "2026-10-01"),
      [cached],
      { updatedAt: 1234 },
    );

    expect(findCachedPublication(client, "workspace-1", cached.id)).toEqual({
      data: cached,
      updatedAt: 1234,
    });
    expect(findCachedPublication(client, "workspace-2", cached.id)).toBeUndefined();
  });

  test("refreshes an existing detail entry from a newer full list response", () => {
    const client = new QueryClient();
    const detailKey = queryKeys.publication("workspace-1", "publication-1");
    client.setQueryData(detailKey, publication("publication-1", "draft"));

    const scheduled = publication("publication-1", "scheduled", "workspace-1", 2);
    const listContext = capturePublicationListCacheContext(client, "workspace-1");
    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [scheduled],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)?.status).toBe("scheduled");
    expect(
      client.getQueryData<Publication>(queryKeys.publication("workspace-2", "publication-1")),
    ).toBeUndefined();
  });

  test("does not let an older revision or timestamp downgrade detail data", () => {
    const client = new QueryClient();
    const detailKey = queryKeys.publication("workspace-1", "publication-1");
    const current = publication(
      "publication-1",
      "published",
      "workspace-1",
      5,
      "2026-09-01T12:00:00Z",
    );
    client.setQueryData(detailKey, current);
    const listContext = capturePublicationListCacheContext(client, "workspace-1");

    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [publication("publication-1", "scheduled", "workspace-1", 4, "2026-09-01T13:00:00Z")],
      listContext,
    );
    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [publication("publication-1", "failed", "workspace-1", 5, "2026-09-01T11:00:00Z")],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)).toEqual(current);
  });

  test("accepts a newer lifecycle state at the same authoring revision", () => {
    const client = new QueryClient();
    const detailKey = queryKeys.publication("workspace-1", "publication-1");
    client.setQueryData(
      detailKey,
      publication("publication-1", "scheduled", "workspace-1", 5, "2026-09-01T12:00:00Z"),
    );
    const published = publication(
      "publication-1",
      "published",
      "workspace-1",
      5,
      "2026-09-01T12:01:00Z",
    );
    const listContext = capturePublicationListCacheContext(client, "workspace-1");

    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [published],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)).toEqual(published);
  });

  test("keeps a same-second detail write created after the list request started", () => {
    const client = new QueryClient();
    const detailKey = queryKeys.publication("workspace-1", "publication-1");
    const listContext = capturePublicationListCacheContext(client, "workspace-1");
    const current = publication(
      "publication-1",
      "published",
      "workspace-1",
      5,
      "2026-09-01T12:00:00Z",
    );
    client.setQueryData(detailKey, current, { updatedAt: 100 });
    expect(client.getQueryState(detailKey)?.dataUpdateCount).toBeGreaterThan(0);

    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [publication("publication-1", "scheduled", "workspace-1", 5, "2026-09-01T12:00:00Z")],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)).toEqual(current);
  });

  test("keeps a same-millisecond detail generation advanced after list start", () => {
    const client = new QueryClient();
    const detailKey = queryKeys.publication("workspace-1", "publication-1");
    client.setQueryData(
      detailKey,
      publication("publication-1", "scheduled", "workspace-1", 5, "2026-09-01T12:00:00Z"),
      { updatedAt: 100 },
    );
    const listContext = capturePublicationListCacheContext(client, "workspace-1");
    const generationAtListStart = listContext.detailGenerations.get("publication-1");
    const current = publication(
      "publication-1",
      "published",
      "workspace-1",
      5,
      "2026-09-01T12:00:00Z",
    );
    client.setQueryData(detailKey, current, { updatedAt: 100 });

    expect(client.getQueryState(detailKey)?.dataUpdatedAt).toBe(100);
    expect(client.getQueryState(detailKey)?.dataUpdateCount).toBeGreaterThan(
      generationAtListStart?.dataUpdateCount ?? 0,
    );
    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [publication("publication-1", "scheduled", "workspace-1", 5, "2026-09-01T12:00:00Z")],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)).toEqual(current);
  });

  test("accepts newer same-second lifecycle data when detail generation is unchanged", () => {
    const client = new QueryClient();
    const detailKey = queryKeys.publication("workspace-1", "publication-1");
    client.setQueryData(
      detailKey,
      publication("publication-1", "scheduled", "workspace-1", 5, "2026-09-01T12:00:00Z"),
      { updatedAt: 100 },
    );
    const listContext = capturePublicationListCacheContext(client, "workspace-1");
    const published = publication(
      "publication-1",
      "published",
      "workspace-1",
      5,
      "2026-09-01T12:00:00Z",
    );

    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope("workspace-1"),
      [published],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)).toEqual(published);
  });

  test("uses list request order when concurrent lifecycle responses arrive out of order", () => {
    for (const newerResponseFirst of [false, true]) {
      const client = new QueryClient();
      const workspaceId = "workspace-1";
      const detailKey = queryKeys.publication(workspaceId, "publication-1");
      const scheduledContext = capturePublicationListCacheContext(client, workspaceId);
      const failedContext = capturePublicationListCacheContext(client, workspaceId);
      const scheduled = publication(
        "publication-1",
        "scheduled",
        workspaceId,
        5,
        "2026-09-01T12:00:00Z",
      );
      const failed = publication("publication-1", "failed", workspaceId, 5, "2026-09-01T12:00:00Z");
      const scheduledResponse = () =>
        cachePublicationDetails(
          client,
          captureWorkspaceQueryScope(workspaceId),
          [scheduled],
          scheduledContext,
        );
      const failedResponse = () =>
        cachePublicationDetails(
          client,
          captureWorkspaceQueryScope(workspaceId),
          [failed],
          failedContext,
        );

      expect(failedContext.requestOrder).toBeGreaterThan(scheduledContext.requestOrder);
      if (newerResponseFirst) {
        failedResponse();
        scheduledResponse();
      } else {
        scheduledResponse();
        failedResponse();
      }

      expect(client.getQueryData<Publication>(detailKey)).toEqual(failed);
      client.clear();
    }
  });

  test("reconciles the original Workspace after only the selection changes", () => {
    const client = new QueryClient();
    const staleScope = captureWorkspaceQueryScope("workspace-1");
    const listContext = capturePublicationListCacheContext(client, "workspace-1");
    markQuerySessionChanged();

    cachePublicationDetails(
      client,
      staleScope,
      [publication("publication-1", "draft")],
      listContext,
    );

    expect(
      client.getQueryData<Publication>(queryKeys.publication("workspace-1", "publication-1")),
    ).toEqual(publication("publication-1", "draft"));
    expect(queryActorScopeIsCurrent(staleScope)).toBe(true);
    expect(querySessionIsCurrent(staleScope)).toBe(false);
  });

  test("does not seed detail data after the authenticated actor changes", () => {
    const client = new QueryClient();
    const staleScope = captureWorkspaceQueryScope("workspace-1");
    const listContext = capturePublicationListCacheContext(client, "workspace-1");
    markQueryActorChanged();

    cachePublicationDetails(
      client,
      staleScope,
      [publication("publication-1", "draft")],
      listContext,
    );

    expect(
      client.getQueryData(queryKeys.publication("workspace-1", "publication-1")),
    ).toBeUndefined();
    expect(queryActorScopeIsCurrent(staleScope)).toBe(false);
  });

  test("rejects a publication before it can poison another Workspace partition", () => {
    const publicationFromAnotherWorkspace = publication("publication-1", "draft", "workspace-2");

    expect(() =>
      requirePublicationWorkspace(publicationFromAnotherWorkspace, "workspace-1"),
    ).toThrow("This post is not in the selected workspace");
    try {
      requirePublicationWorkspace(publicationFromAnotherWorkspace, "workspace-1");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenPostQueryError);
      expect((error as OpenPostQueryError).status).toBe(404);
    }
  });
});

describe("query session scope", () => {
  test("separates actor reconciliation from current Workspace UI state", () => {
    const scope = captureWorkspaceQueryScope("workspace-1");
    const actorRevisions: number[] = [];
    const unsubscribe = subscribeQueryActor(() => actorRevisions.push(getQueryActorRevision()));
    expect(querySessionIsCurrent(scope)).toBe(true);
    expect(workspaceQueryScopeIsCurrent(scope, "workspace-1")).toBe(true);
    expect(workspaceQueryScopeIsCurrent(scope, "workspace-2")).toBe(false);
    expect(() => requireCurrentQuerySession(scope)).not.toThrow();

    markQuerySessionChanged();
    expect(querySessionIsCurrent(scope)).toBe(false);
    expect(queryActorScopeIsCurrent(scope)).toBe(true);
    expect(() => requireCurrentQueryActor(scope)).not.toThrow();

    const currentScope = captureWorkspaceQueryScope("workspace-2");

    markQueryActorChanged();

    expect(actorRevisions).toEqual([getQueryActorRevision()]);
    expect(queryActorScopeIsCurrent(currentScope)).toBe(false);
    expect(workspaceQueryScopeIsCurrent(currentScope, "workspace-2")).toBe(false);
    expect(() => requireCurrentQueryActor(currentScope)).toThrow("signed-in session changed");
    unsubscribe();
  });
});

function publication(
  id: string,
  status: string,
  workspaceId = "workspace-1",
  revision = 1,
  updatedAt = "2026-09-01T12:00:00Z",
): Publication {
  return { id, revision, status, updated_at: updatedAt, workspace_id: workspaceId } as Publication;
}
