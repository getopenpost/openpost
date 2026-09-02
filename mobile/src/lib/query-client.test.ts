import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const TOKEN_KEY = "openpost.auth.token";
const SERVER_KEY = "openpost.server.baseUrl";
const values = new Map<string, string>();
let pendingServerWrite: { started: Deferred<void>; release: Deferred<void> } | null = null;
let failingServerValue: string | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    const pending = key === SERVER_KEY ? pendingServerWrite : null;
    if (pending) {
      pendingServerWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === SERVER_KEY && value === failingServerValue) {
      throw new Error("SecureStore server write failed");
    }
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
    pendingServerWrite = null;
    failingServerValue = null;
    values.clear();
    await loadToken();
    await loadWorkspaceId();
    queryClient.clear();
  });

  afterEach(() => {
    pendingServerWrite?.release.resolve();
    pendingServerWrite = null;
    failingServerValue = null;
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

  test("does not settle a query 401 captured during a failed server transition", async () => {
    await setServer("https://query-before-transition.example.com");
    expect(await commitTokenForIdentity("token-current", captureApiRequestIdentity())).toBe(true);
    const started = deferred<void>();
    const release = deferred<void>();
    pendingServerWrite = { started, release };
    failingServerValue = "https://query-failed-transition.example.com";
    const transition = setServer(failingServerValue);
    await started.promise;

    await settleApiUnauthorized(captureApiRequestIdentity(), new Response(null, { status: 401 }));
    release.resolve();
    await expect(transition).rejects.toThrow("SecureStore server write failed");

    expect(getToken()).toBe("token-current");
    expect(values.get(TOKEN_KEY)).toBe("token-current");
    expect(values.get(SERVER_KEY)).toBe("https://query-before-transition.example.com");
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

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
