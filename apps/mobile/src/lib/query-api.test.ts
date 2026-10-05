import { expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "@openpost/api-contract";

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
    { days: 7, accountId: "account-b", sort: "views", limit: 10 },
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
      { days: 30, accountId: "", sort: "engagement", limit: 50 },
      "",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 503 });
  const url = new URL(received!.url);
  expect(url.searchParams.has("account_id")).toBe(false);
  expect(url.searchParams.has("cursor")).toBe(false);
});
