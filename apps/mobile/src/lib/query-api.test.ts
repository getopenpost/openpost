import { expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";
import { normalizeAnalyticsFilters } from "@openpost/query-catalog";

mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const { createMobileQueryAPI } = await import("./query-api");

test("sends workspace, account, range and pagination to the analytics API", async () => {
  let received: Request | undefined;
  const result = { range_days: 7, content_next_cursor: "next-page" };
  const transport = createClient<paths>({
    baseUrl: "https://review.invalid/api/v1",
    fetch: async (request) => {
      received = request;
      return Response.json(result);
    },
  });
  const controller = new AbortController();
  const overview = await createMobileQueryAPI(() => transport).getAnalyticsOverview(
    "workspace-a",
    { days: 7, accountId: "account-b", accountIds: ["account-b"], sort: "views", limit: 10 },
    "page-c",
    controller.signal,
  );

  expect(overview).toMatchObject(result);
  expect(received).toBeDefined();
  const url = new URL(received!.url);
  expect(url.pathname).toBe("/api/v1/analytics");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    workspace_id: "workspace-a",
    days: "7",
    account_id: "account-b",
    account_ids: "account-b",
    sort: "views",
    cursor: "page-c",
    limit: "10",
  });
  controller.abort();
  expect(received!.signal.aborted).toBe(true);
});

test("omits unselected analytics filters and surfaces server failures", async () => {
  let received: Request | undefined;
  const transport = createClient<paths>({
    baseUrl: "https://review.invalid/api/v1",
    fetch: async (request) => {
      received = request;
      return Response.json({ detail: "Analytics unavailable" }, { status: 503 });
    },
  });
  await expect(
    createMobileQueryAPI(() => transport).getAnalyticsOverview(
      "workspace-a",
      { days: 30, accountId: "", accountIds: [], sort: "engagement", limit: 50 },
      "",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 503 });
  const url = new URL(received!.url);
  expect(url.searchParams.has("account_id")).toBe(false);
  expect(url.searchParams.has("account_ids")).toBe(false);
  expect(url.searchParams.has("cursor")).toBe(false);
});

test("sends the normalized multi-account selection with pagination", async () => {
  let received: Request | undefined;
  const transport = createClient<paths>({
    baseUrl: "https://review.invalid/api/v1",
    fetch: async (request) => {
      received = request;
      return Response.json({ content: [], content_total: 0 });
    },
  });
  await createMobileQueryAPI(() => transport).getAnalyticsOverview(
    "workspace-a",
    normalizeAnalyticsFilters({ days: 30, accountIds: [" account-c ", "account-b", "account-c"] }),
    "selection-page",
    new AbortController().signal,
  );
  const url = new URL(received!.url);
  expect(url.searchParams.get("account_ids")).toBe("account-b,account-c");
  expect(url.searchParams.has("account_id")).toBe(false);
  expect(url.searchParams.get("cursor")).toBe("selection-page");
  expect(url.searchParams.get("workspace_id")).toBe("workspace-a");
});

test.each([200, 404, 403, 503])(
  "browses project summaries with compatible server status %i",
  async (status) => {
    const requests: Request[] = [];
    let selectTransport = 0;
    const controller = new AbortController();
    const metadata = {
      id: "project",
      workspace_id: "workspace-a",
      name: "Launch",
      head_revision: 1,
      sync_status: "synced" as const,
      created_by_user_id: "user",
      updated_by_user_id: "user",
      created_at: "2026-10-13T20:00:00Z",
      updated_at: "2026-10-13T20:00:00Z",
    };
    const transport = createClient<paths>({
      baseUrl: "https://review.invalid/api/v1",
      fetch: async (request) => {
        requests.push(request);
        if (new URL(request.url).pathname.endsWith("/video-projects"))
          return Response.json([
            { ...metadata, document: { schemaFamily: "quick-cut", timeline: { items: [] } } },
          ]);
        return status === 200
          ? Response.json([{ ...metadata, schema_family: "quick-cut" }])
          : Response.json({ detail: "Summary request failed" }, { status });
      },
    });
    const api = createMobileQueryAPI(() => {
      selectTransport++;
      return transport;
    });
    const result = api.listVideoProjectSummaries("workspace-a", true, controller.signal);
    if (status === 200 || status === 404) {
      await expect(result).resolves.toEqual([{ ...metadata, schema_family: "quick-cut" }]);
    } else {
      await expect(result).rejects.toMatchObject({ status });
    }
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(
      status === 404
        ? ["/api/v1/video-project-summaries", "/api/v1/video-projects"]
        : ["/api/v1/video-project-summaries"],
    );
    expect(selectTransport).toBe(1);
    for (const request of requests)
      expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
        workspace_id: "workspace-a",
        include_trash: "true",
      });
    controller.abort();
    expect(requests.every((request) => request.signal.aborted)).toBe(true);
  },
);

test("loads the submitted review snapshots through the publication review route", async () => {
  let received: Request | undefined;
  const transport = createClient<paths>({
    baseUrl: "https://review.invalid/api/v1",
    fetch: async (request) => {
      received = request;
      return Response.json([
        {
          id: "review-a",
          publication_id: "post-a",
          workspace_id: "workspace-a",
          snapshot: { title: "Submitted version" },
        },
      ]);
    },
  });
  const controller = new AbortController();
  const rows = await createMobileQueryAPI(() => transport).listPublicationReviews(
    "workspace-a",
    "post-a",
    controller.signal,
  );
  expect(new URL(received!.url).pathname).toBe("/api/v1/publications/post-a/reviews");
  expect(rows[0]?.snapshot.title).toBe("Submitted version");
  controller.abort();
  expect(received!.signal.aborted).toBe(true);
});
