import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const TOKEN_KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const values = new Map<string, string>();

mock.module("expo-constants", () => ({
  default: { expoConfig: { version: "test" } },
}));
mock.module("react-native", () => ({ Platform: { OS: "ios" } }));
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
const { captureApiRequestIdentity, commitTokenForIdentity } = await import("./api/client");
const { login, pollPairing, signOut, verifyTotp } = await import("./auth");

describe("auth request identity", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    values.clear();
    await loadToken();
    await loadWorkspaceId();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("does not save an old login response after the server changes", async () => {
    const request = deferredFetch();
    await setServer("https://old-login-server.example.com");
    const signingIn = login("founder@example.com", "password");
    await request.started.promise;
    await setServer("https://new.example.com");
    request.respond({ token: "token-stale" });

    await expect(signingIn).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not save an old login response after a newer token queues", async () => {
    const request = deferredFetch();
    await setServer("https://old-login-token.example.com");
    const signingIn = login("founder@example.com", "password");
    await request.started.promise;
    expect(await commitTokenForIdentity("token-new", captureApiRequestIdentity())).toBe(true);
    request.respond({ token: "token-stale" });

    await expect(signingIn).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBe("token-new");
    expect(values.get(TOKEN_KEY)).toBe("token-new");
  });

  test("does not approve stale pairing after the server changes", async () => {
    const request = deferredFetch();
    await setServer("https://old-pairing.example.com");
    const polling = pollPairing("device-code");
    await request.started.promise;
    await setServer("https://new.example.com");
    request.respond({ status: "approved", token: "token-stale" });

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not save a stale TOTP response after the server changes", async () => {
    const request = deferredFetch();
    await setServer("https://old-totp.example.com");
    const verifying = verifyTotp("mfa-token", "123456");
    await request.started.promise;
    await setServer("https://new.example.com");
    request.respond({ token: "token-stale" });

    await expect(verifying).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not approve stale pairing after a newer token queues", async () => {
    const request = deferredFetch();
    await setServer("https://old-pairing-token.example.com");
    const polling = pollPairing("device-code");
    await request.started.promise;
    expect(await commitTokenForIdentity("token-new", captureApiRequestIdentity())).toBe(true);
    request.respond({ status: "approved", token: "token-stale" });

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBe("token-new");
    expect(values.get(TOKEN_KEY)).toBe("token-new");
  });

  test("does not let an old logout clear a newer token", async () => {
    await hydrate("token-old", "workspace-old");
    const request = deferredFetch();
    await setServer("https://old-logout.example.com");
    const signingOut = signOut();
    await request.started.promise;
    expect(await commitTokenForIdentity("token-new", captureApiRequestIdentity())).toBe(true);
    request.respond(undefined, 204);

    expect(await signingOut).toBe(false);
    expect(getToken()).toBe("token-new");
    expect(values.get(TOKEN_KEY)).toBe("token-new");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
  });
});

async function hydrate(token: string, workspaceId: string): Promise<void> {
  values.set(TOKEN_KEY, token);
  values.set(WORKSPACE_KEY, workspaceId);
  await loadToken();
  await loadWorkspaceId();
}

function deferredFetch() {
  const started = deferred<void>();
  const response = deferred<Response>();
  globalThis.fetch = (async () => {
    started.resolve();
    return response.promise;
  }) as unknown as typeof fetch;
  return {
    started,
    respond(body?: unknown, status = 200) {
      response.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
        }),
      );
    },
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
