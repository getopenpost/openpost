import { describe, expect, test } from "bun:test";
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  openPostQueryDefaults,
  openPostQueryPolicy,
  queryStaleTime,
  type QueryPageResult,
} from "@openpost/query-catalog";

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
  queryKeys,
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

const standardQueryPolicy = openPostQueryPolicy(queryStaleTime);

describe("mobile query policy", () => {
  test("runs consequential mutations once instead of queuing them for reconnect", async () => {
    expect(openPostQueryDefaults.mutations).toEqual({
      networkMode: "always",
      retry: false,
      throwOnError: false,
    });

    const client = new QueryClient({
      defaultOptions: { mutations: openPostQueryDefaults.mutations },
    });
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
  test("does not bridge mounted observer data across Workspace keys", () => {
    const client = new QueryClient();
    const workspaceOneKey = queryKeys.publicationActivity("workspace-1", "draft");
    const workspaceTwoKey = queryKeys.publicationActivity("workspace-2", "draft");
    const cached = publicationPage(publication("publication-1", "draft"));
    const queryFn = async () => cached;
    client.setQueryData(workspaceOneKey, cached);
    const observer = new QueryObserver(client, {
      ...standardQueryPolicy,
      enabled: false,
      queryKey: workspaceOneKey,
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(observer.getCurrentResult().data).toEqual(cached);
    observer.setOptions({
      ...standardQueryPolicy,
      enabled: false,
      queryKey: workspaceTwoKey,
      queryFn,
    });
    expect(observer.getCurrentResult().data).toBeUndefined();

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

    client.setQueryData(draftKey, publicationPage(existing), { updatedAt: 1 });
    await client.cancelQueries({ queryKey: draftKey, exact: true });
    const observer = new QueryObserver<QueryPageResult<Publication>, OpenPostQueryError>(client, {
      ...standardQueryPolicy,
      staleTime: 0,
      queryKey: draftKey,
      queryFn: ({ signal }) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(publicationPage(created, existing));
        firstRequestSignal = signal;
        markStarted();
        return new Promise<QueryPageResult<Publication>>((_, reject) => {
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
    expect(
      client.getQueryData<QueryPageResult<Publication>>(draftKey)?.items.map(({ id }) => id),
    ).toEqual(["publication-2", "publication-1"]);
    unsubscribe();
    client.clear();
  });

  test("uses a publication already loaded by any list as detail data", () => {
    const client = new QueryClient();
    const scheduled = publication("publication-1", "scheduled");
    client.setQueryData(
      queryKeys.calendarRange("workspace-1", "2026-09-01", "2026-10-01"),
      [scheduled],
      { updatedAt: 1234 },
    );
    const draft = publication("publication-2", "draft");
    client.setQueryData(
      queryKeys.publicationActivity("workspace-1", "draft"),
      { items: [draft], total: 1, nextCursor: "" },
      { updatedAt: 4321 },
    );

    expect(findCachedPublication(client, "workspace-1", scheduled.id)).toEqual({
      data: scheduled,
      updatedAt: 1234,
    });
    expect(findCachedPublication(client, "workspace-1", draft.id)).toEqual({
      data: draft,
      updatedAt: 4321,
    });
    expect(findCachedPublication(client, "workspace-2", scheduled.id)).toBeUndefined();
    client.clear();
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

function publicationPage(...items: Publication[]): QueryPageResult<Publication> {
  return { items, total: items.length, nextCursor: "" };
}
