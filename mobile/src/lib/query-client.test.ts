import { beforeEach, describe, expect, mock, test } from "bun:test";

const TOKEN_KEY = "openpost.auth.token";
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
const { getToken, loadToken, loadWorkspaceId } = await import("./api/token-store");
const { captureApiRequestIdentity, commitTokenForIdentity, settleApiUnauthorized } =
  await import("./api/client");
const { queryClient } = await import("./query-client");
const { workspacesOptions } = await import("./queries");

describe("query session cache", () => {
  beforeEach(async () => {
    values.clear();
    await loadToken();
    await loadWorkspaceId();
    queryClient.clear();
  });

  test("clears cached server state when the token or server changes", async () => {
    await setServer("https://cache-clear.example.com");
    const queryKey = ["openpost", "v1", "workspaces"];

    queryClient.setQueryData(queryKey, [{ id: "workspace-1" }]);
    expect(await commitTokenForIdentity("token-2", captureApiRequestIdentity())).toBe(true);
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    queryClient.setQueryData(queryKey, [{ id: "workspace-1" }]);
    await setServer("https://another.example.com");
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });

  test("settles a query 401 only against the server and token that started it", async () => {
    await setServer("https://identity.example.com");
    expect(await commitTokenForIdentity("token-a", captureApiRequestIdentity())).toBe(true);
    const staleIdentity = captureApiRequestIdentity();
    expect(await commitTokenForIdentity("token-b", staleIdentity)).toBe(true);

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
      values.set(TOKEN_KEY, "expired-token");
      await loadToken();

      await expect(queryClient.fetchQuery(workspacesOptions())).rejects.toBeInstanceOf(Error);
      expect(getToken()).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
