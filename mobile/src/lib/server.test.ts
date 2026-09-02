import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  activityPublicationsQueryOptions,
  liveQueryStaleTime,
  openPostBootstrapQueryKeys,
  queryStaleTime,
  type AppBootstrap,
  type QueryPageResult,
  workspaceAccountsQueryOptions,
} from "@openpost/query-catalog";

import type { Publication } from "./query-cache";

const values = new Map<string, string>();
let deleteFailureKey: string | null = null;
let workspaceWrite: {
  operation: "delete" | "set";
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    const pending = workspaceWrite;
    if (key === "openpost.workspace.id" && pending?.operation === "set") {
      workspaceWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (key === deleteFailureKey) throw new Error("SecureStore delete failed");
    const pending = workspaceWrite;
    if (key === "openpost.workspace.id" && pending?.operation === "delete") {
      workspaceWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    values.delete(key);
  },
}));

const { getServer, loadServer, setServer } = await import("./server");
const {
  clearToken,
  clearWorkspaceId,
  getToken,
  getWorkspaceId,
  loadWorkspaceId,
  saveToken,
  saveWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} = await import("./api/token-store");
const { queryClient } = await import("./query-client");
const { accountsOptions, publicationActivityOptions, publicationOptions, workspacesOptions } =
  await import("./queries");
const { captureApiRequestIdentity, commitWorkspaceIdForIdentity, settleApiUnauthorized } =
  await import("./api/client");
const { cachePublicationDetails, capturePublicationListCacheContext } =
  await import("./query-cache");
const { queryKeys } = await import("./query-policy");
const { captureWorkspaceQueryScope } = await import("./query-session");
const { synchronizeSession } = await import("./session");
const { completeWorkspaceSelection } = await import("./workspace-selection");

describe("server persistence", () => {
  beforeEach(() => values.clear());

  test("preserves self-hosted servers", async () => {
    await setServer("https://social.example.com");

    expect(await loadServer()).toEqual({
      baseUrl: "https://social.example.com",
      isHosted: false,
    });
    expect(values.get("openpost.server.baseUrl")).toBe("https://social.example.com");
  });
});

describe("token persistence", () => {
  test("publishes only durable token changes to subscribers and query cache", async () => {
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeToken(() => snapshots.push(getToken()));

    const saving = saveToken("token-1");
    expect(getToken()).toBeNull();
    expect(snapshots).toEqual([]);
    await saving;
    expect(snapshots).toEqual(["token-1"]);

    const clearing = clearToken();
    expect(snapshots).toEqual(["token-1"]);
    await clearing;
    expect(snapshots).toEqual(["token-1", null]);

    await saveToken("token-2");
    const queryKey = ["openpost", "v1", "workspaces"];
    queryClient.setQueryData(queryKey, [{ id: "workspace-1" }]);
    deleteFailureKey = "openpost.auth.token";
    await expect(clearToken()).rejects.toThrow("SecureStore delete failed");
    expect(getToken()).toBe("token-2");
    expect(values.get("openpost.auth.token")).toBe("token-2");
    expect(queryClient.getQueryData<{ id: string }[]>(queryKey)).toEqual([{ id: "workspace-1" }]);
    deleteFailureKey = null;
    await clearToken();
    unsubscribe();
  });

  test("publishes only a durable preferred Workspace", async () => {
    await saveWorkspaceId("workspace-1");
    expect(getWorkspaceId()).toBe("workspace-1");
    expect(values.get("openpost.workspace.id")).toBe("workspace-1");

    await loadWorkspaceId();
    expect(getWorkspaceId()).toBe("workspace-1");

    await clearWorkspaceId();
    expect(getWorkspaceId()).toBeNull();
    expect(values.has("openpost.workspace.id")).toBe(false);
  });
});

describe("session workspace persistence", () => {
  for (const scenario of [
    { name: "overwrite", operation: "set" as const, selectedWorkspaceId: "workspace-2" },
    { name: "clear", operation: "delete" as const, selectedWorkspaceId: null },
  ]) {
    test(`an old bootstrap cannot ${scenario.name} the workspace after its server changes mid-write`, async () => {
      await setServer("https://old.example.com");
      await saveToken("token-old");
      await saveWorkspaceId("workspace-1");

      const started = deferred<void>();
      const release = deferred<void>();
      workspaceWrite = { operation: scenario.operation, started, release };
      const client = new QueryClient();
      const request = synchronizeSession(
        {
          queryClient: client,
          getServer,
          getToken,
          getWorkspaceId,
          commitWorkspaceId: commitWorkspaceIdForIdentity,
          clearToken,
          readAppBootstrap: async () => appBootstrap(scenario.selectedWorkspaceId),
        },
        new AbortController().signal,
      );

      await started.promise;
      await setServer("https://new.example.com");
      release.resolve();

      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(values.get("openpost.workspace.id")).toBe("workspace-1");
      expect(getWorkspaceId()).toBe("workspace-1");
      expect(client.getQueryData(openPostBootstrapQueryKeys.workspaces())).toBeUndefined();
      client.clear();
      await clearToken();
    });
  }

  for (const scenario of [
    { name: "overwrite", operation: "set" as const, selectedWorkspaceId: "workspace-2" },
    { name: "clear", operation: "delete" as const, selectedWorkspaceId: null },
  ]) {
    test(`an old bootstrap cannot ${scenario.name} the workspace after a token change queues mid-write`, async () => {
      await setServer("https://identity.example.com");
      await saveToken("token-old");
      await saveWorkspaceId("workspace-1");
      const snapshots: (string | null)[] = [];
      const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
      const started = deferred<void>();
      const release = deferred<void>();
      workspaceWrite = { operation: scenario.operation, started, release };
      const client = new QueryClient();
      let tokenChange = Promise.resolve();

      try {
        const request = synchronizeSession(
          {
            queryClient: client,
            getServer,
            getToken,
            getWorkspaceId,
            commitWorkspaceId: commitWorkspaceIdForIdentity,
            clearToken,
            readAppBootstrap: async () => appBootstrap(scenario.selectedWorkspaceId),
          },
          new AbortController().signal,
        );

        await started.promise;
        tokenChange = saveToken("token-new");
        release.resolve();

        await expect(request).rejects.toMatchObject({ name: "AbortError" });
        await tokenChange;
        expect(values.has("openpost.workspace.id")).toBe(false);
        expect(getWorkspaceId()).toBeNull();
        expect(snapshots).toEqual([null]);
        expect(client.getQueryData(openPostBootstrapQueryKeys.workspaces())).toBeUndefined();
      } finally {
        release.resolve();
        await tokenChange;
        unsubscribe();
        client.clear();
        await clearToken();
      }
    });
  }
});

describe("direct workspace selection", () => {
  test("persists, publishes, and navigates once for the current identity", async () => {
    await setServer("https://identity.example.com");
    await saveToken("token-current");
    await saveWorkspaceId("workspace-1");
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
    let navigationCount = 0;

    try {
      const committed = await completeWorkspaceSelection("workspace-2", () => {
        navigationCount += 1;
      });

      expect(committed).toBe(true);
      expect(navigationCount).toBe(1);
      expect(values.get("openpost.workspace.id")).toBe("workspace-2");
      expect(getWorkspaceId()).toBe("workspace-2");
      expect(snapshots).toEqual(["workspace-2"]);
    } finally {
      unsubscribe();
      await clearToken();
    }
  });

  test("does not persist or navigate after the server changes during its write", async () => {
    await setServer("https://old.example.com");
    await saveToken("token-old");
    await saveWorkspaceId("workspace-1");
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
    const started = deferred<void>();
    const release = deferred<void>();
    workspaceWrite = { operation: "set", started, release };
    let navigationCount = 0;

    try {
      const selection = completeWorkspaceSelection("workspace-2", () => {
        navigationCount += 1;
      });
      await started.promise;
      await setServer("https://new.example.com");
      release.resolve();

      expect(await selection).toBe(false);
      expect(navigationCount).toBe(0);
      expect(values.get("openpost.workspace.id")).toBe("workspace-1");
      expect(getWorkspaceId()).toBe("workspace-1");
      expect(snapshots).toEqual([]);
    } finally {
      release.resolve();
      unsubscribe();
      await clearToken();
    }
  });

  test("does not publish or navigate when a token change queues during its write", async () => {
    await setServer("https://identity.example.com");
    await saveToken("token-old");
    await saveWorkspaceId("workspace-1");
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
    const started = deferred<void>();
    const release = deferred<void>();
    workspaceWrite = { operation: "set", started, release };
    let navigationCount = 0;

    try {
      const selection = completeWorkspaceSelection("workspace-2", () => {
        navigationCount += 1;
      });
      await started.promise;
      const tokenChange = saveToken("token-new");
      release.resolve();

      expect(await selection).toBe(false);
      await tokenChange;
      expect(navigationCount).toBe(0);
      expect(values.has("openpost.workspace.id")).toBe(false);
      expect(getWorkspaceId()).toBeNull();
      expect(snapshots).toEqual([null]);
    } finally {
      release.resolve();
      unsubscribe();
      await clearToken();
    }
  });
});

describe("publication detail initial data", () => {
  test("lets an in-flight list replace a later initialData-only detail", () => {
    const client = new QueryClient();
    const workspaceId = "workspace-1";
    const publicationId = "publication-1";
    const detailKey = queryKeys.publication(workspaceId, publicationId);
    const scheduled = publication(publicationId, "scheduled");
    client.setQueryData<QueryPageResult<Publication>>(
      queryKeys.publicationActivity(workspaceId, "scheduled"),
      { items: [scheduled], total: 1, nextCursor: "" },
      { updatedAt: 100 },
    );
    const listContext = capturePublicationListCacheContext(client, workspaceId);

    const observer = new QueryObserver(
      client,
      publicationOptions(client, workspaceId, publicationId),
    );
    expect(observer.getCurrentResult().data).toEqual(scheduled);
    expect(client.getQueryState(detailKey)?.dataUpdateCount).toBe(0);

    const published = publication(publicationId, "published");
    cachePublicationDetails(
      client,
      captureWorkspaceQueryScope(workspaceId),
      [published],
      listContext,
    );

    expect(client.getQueryData<Publication>(detailKey)).toEqual(published);
    observer.destroy();
    client.clear();
  });
});

describe("publication detail request ordering", () => {
  test("does not let a slow detail response overwrite a newer list seed", async () => {
    const client = new QueryClient();
    const workspaceId = "workspace-1";
    const publicationId = "publication-1";
    const detailKey = queryKeys.publication(workspaceId, publicationId);
    const detailResponse = publication(publicationId, "scheduled");
    const fetchControl = installDeferredPublicationFetch(detailResponse);

    try {
      await setServer("https://detail-order-one.example.com");
      const request = client.fetchQuery(publicationOptions(client, workspaceId, publicationId));
      await fetchControl.started;

      const listContext = capturePublicationListCacheContext(client, workspaceId);
      const published = publication(publicationId, "published");
      cachePublicationDetails(
        client,
        captureWorkspaceQueryScope(workspaceId),
        [published],
        listContext,
      );
      fetchControl.respond(detailResponse);

      expect(await request).toEqual(published);
      expect(client.getQueryData<Publication>(detailKey)).toEqual(published);
    } finally {
      fetchControl.restore();
      client.clear();
    }
  });

  test("lets a genuinely newer detail response replace a concurrent list seed", async () => {
    const client = new QueryClient();
    const workspaceId = "workspace-1";
    const publicationId = "publication-1";
    const detailKey = queryKeys.publication(workspaceId, publicationId);
    const scheduled = publication(publicationId, "scheduled");
    client.setQueryData(detailKey, scheduled);
    const detailResponse = publication(publicationId, "published", 6, "2026-09-01T12:01:00Z");
    const fetchControl = installDeferredPublicationFetch(detailResponse);

    try {
      await setServer("https://detail-order-two.example.com");
      const request = client.fetchQuery({
        ...publicationOptions(client, workspaceId, publicationId),
        staleTime: 0,
      });
      await fetchControl.started;

      const listContext = capturePublicationListCacheContext(client, workspaceId);
      const failed = publication(publicationId, "failed");
      cachePublicationDetails(
        client,
        captureWorkspaceQueryScope(workspaceId),
        [failed],
        listContext,
      );
      fetchControl.respond(detailResponse);

      expect(await request).toEqual(detailResponse);
      expect(client.getQueryData<Publication>(detailKey)).toEqual(detailResponse);
    } finally {
      fetchControl.restore();
      client.clear();
    }
  });
});

describe("query session cache", () => {
  test("clears cached server state when the token or server changes", async () => {
    const queryKey = ["openpost", "v1", "workspaces"];

    queryClient.setQueryData(queryKey, [{ id: "workspace-1" }]);
    await saveToken("token-2");
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    queryClient.setQueryData(queryKey, [{ id: "workspace-1" }]);
    await setServer("https://another.example.com");
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    await clearToken();
  });

  test("settles a query 401 only against the server and token that started it", async () => {
    await setServer("https://identity.example.com");
    await saveToken("token-a");
    const staleIdentity = captureApiRequestIdentity();
    await saveToken("token-b");

    await settleApiUnauthorized(staleIdentity, new Response(null, { status: 401 }));
    expect(getToken()).toBe("token-b");

    queryClient.setQueryData(["openpost", "v1", "actor-data"], "private");
    await settleApiUnauthorized(captureApiRequestIdentity(), new Response(null, { status: 401 }));
    expect(getToken()).toBeNull();
    expect(queryClient.getQueryData(["openpost", "v1", "actor-data"])).toBeUndefined();
  });

  test("routes ordinary query 401 responses through token settlement", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "Session expired" }), {
        status: 401,
        headers: { "Content-Type": "application/problem+json" },
      })) as unknown as typeof fetch;
    try {
      await setServer("https://expired.example.com");
      await saveToken("expired-token");

      await expect(queryClient.fetchQuery(workspacesOptions())).rejects.toBeInstanceOf(Error);
      expect(getToken()).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      await clearToken();
    }
  });
});

describe("shared query definition parity", () => {
  test("uses the canonical keys and freshness for mobile publications and accounts", () => {
    const client = new QueryClient();
    const sharedScheduled = activityPublicationsQueryOptions(
      { listActivityPublications: async () => ({ items: [], total: 0, nextCursor: "" }) },
      "workspace-1",
      "scheduled",
      { limit: 100 },
    );
    const mobileScheduled = publicationActivityOptions(client, "workspace-1", "scheduled");
    expect(mobileScheduled.queryKey as readonly unknown[]).toEqual(
      sharedScheduled.queryKey as readonly unknown[],
    );
    expect(mobileScheduled.staleTime).toBe(liveQueryStaleTime);
    expect(mobileScheduled.staleTime).toBe(sharedScheduled.staleTime);
    expect(mobileScheduled.retry).toBe(sharedScheduled.retry);

    const sharedAccounts = workspaceAccountsQueryOptions(
      { listAccounts: async () => [] },
      "workspace-1",
    );
    const mobileAccounts = accountsOptions("workspace-1");
    expect(mobileAccounts.queryKey as readonly unknown[]).toEqual(
      sharedAccounts.queryKey as readonly unknown[],
    );
    expect(mobileAccounts.staleTime).toBe(queryStaleTime);
    expect(mobileAccounts.staleTime).toBe(sharedAccounts.staleTime);
    expect(mobileAccounts.retry).toBe(sharedAccounts.retry);
  });
});

function publication(
  id: string,
  status: string,
  revision = 5,
  updatedAt = "2026-09-01T12:00:00Z",
): Publication {
  return {
    id,
    revision,
    status,
    updated_at: updatedAt,
    workspace_id: "workspace-1",
  } as Publication;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function appBootstrap(selectedWorkspaceId: string | null): AppBootstrap {
  const selected = selectedWorkspaceId
    ? {
        avatar_url: "",
        can_edit: true,
        color: "#000000",
        created_at: "2026-09-01T00:00:00Z",
        id: selectedWorkspaceId,
        name: "Workspace",
        organization_id: "organization-1",
        organization_name: "Organization",
        role: "admin" as const,
        sso_authenticated: true,
        sso_identity_linked: true,
        sso_required: false,
      }
    : null;
  return {
    authenticated: true,
    selected_workspace_id: selectedWorkspaceId,
    selected_workspace_settings: selected
      ? {
          avatar_url: "",
          color: "#000000",
          media_cleanup_days: 14,
          name: selected.name,
          random_delay_minutes: 0,
          slot_end_hour: 17,
          slot_interval_minutes: 60,
          slot_start_hour: 9,
          timezone: "UTC",
          week_start: 1,
        }
      : null,
    user: null,
    workspaces: selected ? [selected] : [],
  };
}

function installDeferredPublicationFetch(fallback: Publication) {
  const originalFetch = globalThis.fetch;
  let markStarted: () => void = () => undefined;
  let releaseResponse: (response: Response) => void = () => undefined;
  let responded = false;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    releaseResponse = resolve;
  });
  globalThis.fetch = (async () => {
    markStarted();
    return response;
  }) as unknown as typeof fetch;

  function respond(publication: Publication) {
    if (responded) return;
    responded = true;
    releaseResponse(
      new Response(JSON.stringify(publication), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  }

  return {
    started,
    respond,
    restore() {
      respond(fallback);
      globalThis.fetch = originalFetch;
    },
  };
}
