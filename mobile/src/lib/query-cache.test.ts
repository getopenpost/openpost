import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { QueryPageResult } from "@openpost/query-catalog";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import type { Publication } from "./query-cache";

const values = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    values.delete(key);
  },
}));

const { setServer } = await import("./server");
const { publicationOptions } = await import("./queries");
const { cachePublicationDetails, capturePublicationListCacheContext } =
  await import("./query-cache");
const { queryKeys } = await import("./query-policy");
const { captureWorkspaceQueryScope } = await import("./query-session");

describe("publication detail cache ordering", () => {
  beforeEach(async () => {
    await setServer("https://publication-cache.example.com");
  });

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

  function respond(nextPublication: Publication) {
    if (responded) return;
    responded = true;
    releaseResponse(
      new Response(JSON.stringify(nextPublication), {
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
