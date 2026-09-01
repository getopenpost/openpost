import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import type { Publication } from "./query-cache";

const values = new Map<string, string>();
let deleteFailureKey: string | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (key === deleteFailureKey) throw new Error("SecureStore delete failed");
    values.delete(key);
  },
}));

const { loadServer, setServer } = await import("./server");
const {
  clearToken,
  clearWorkspaceId,
  getToken,
  getWorkspaceId,
  loadWorkspaceId,
  saveToken,
  saveWorkspaceId,
  subscribeToken,
} = await import("./api/token-store");
const { queryClient } = await import("./query-client");
const { publicationOptions } = await import("./queries");
const { cachePublicationDetails, capturePublicationListCacheContext } =
  await import("./query-cache");
const { queryKeys } = await import("./query-policy");
const { captureWorkspaceQueryScope } = await import("./query-session");

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

describe("publication detail initial data", () => {
  test("lets an in-flight list replace a later initialData-only detail", () => {
    const client = new QueryClient();
    const workspaceId = "workspace-1";
    const publicationId = "publication-1";
    const detailKey = queryKeys.publication(workspaceId, publicationId);
    const scheduled = publication(publicationId, "scheduled");
    client.setQueryData(queryKeys.publicationActivity(workspaceId, "scheduled"), [scheduled], {
      updatedAt: 100,
    });
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
