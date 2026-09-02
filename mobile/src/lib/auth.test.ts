import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

type ServerStoreOperation = "delete" | "set";

const TOKEN_KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const SERVER_KEY = "openpost.server.baseUrl";
const values = new Map<string, string>();
let pendingServerWrite: {
  operation: ServerStoreOperation;
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;
let pendingTokenWrite: { started: Deferred<void>; release: Deferred<void> } | null = null;
let failingServerOperation: ServerStoreOperation | null = null;

mock.module("expo-constants", () => ({
  default: { expoConfig: { version: "test" } },
}));
mock.module("react-native", () => ({ Platform: { OS: "ios" } }));
mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    const tokenPending = key === TOKEN_KEY ? pendingTokenWrite : null;
    if (tokenPending) {
      pendingTokenWrite = null;
      tokenPending.started.resolve();
      await tokenPending.release.promise;
    }
    const pending =
      key === SERVER_KEY && pendingServerWrite?.operation === "set" ? pendingServerWrite : null;
    if (pending) {
      pendingServerWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === SERVER_KEY && failingServerOperation === "set") {
      failingServerOperation = null;
      throw new Error("SecureStore server write failed");
    }
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    const pending =
      key === SERVER_KEY && pendingServerWrite?.operation === "delete" ? pendingServerWrite : null;
    if (pending) {
      pendingServerWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === SERVER_KEY && failingServerOperation === "delete") {
      failingServerOperation = null;
      throw new Error("SecureStore server write failed");
    }
    values.delete(key);
  },
}));

const { clearServer, getServer, setServer } = await import("./server");
const { getToken, loadToken, loadWorkspaceId } = await import("./api/token-store");
const { captureApiRequestIdentity, commitTokenForIdentity } = await import("./api/client");
const { login, pollPairing, signOut, verifyTotp } = await import("./auth");

describe("auth request identity", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    pendingServerWrite = null;
    pendingTokenWrite = null;
    failingServerOperation = null;
    values.clear();
    await loadToken();
    await loadWorkspaceId();
  });

  afterEach(() => {
    pendingServerWrite?.release.resolve();
    pendingTokenWrite?.release.resolve();
    pendingServerWrite = null;
    pendingTokenWrite = null;
    failingServerOperation = null;
    globalThis.fetch = originalFetch;
  });

  for (const transition of [
    { action: "set", outcome: "success" },
    { action: "set", outcome: "failure" },
    { action: "clear", outcome: "success" },
    { action: "clear", outcome: "failure" },
  ] as const) {
    test(`does not save a login captured during a pending server ${transition.action} ${transition.outcome}`, async () => {
      const request = deferredFetch();
      const previousServer = `https://old-${transition.action}-${transition.outcome}.example.com`;
      await setServer(previousServer);
      const serverStarted = deferred<void>();
      const releaseServer = deferred<void>();
      const storeOperation = transition.action === "set" ? "set" : "delete";
      pendingServerWrite = {
        operation: storeOperation,
        started: serverStarted,
        release: releaseServer,
      };
      if (transition.outcome === "failure") failingServerOperation = storeOperation;
      const serverTransition =
        transition.action === "set"
          ? setServer("https://replacement-pending-login.example.com")
          : clearServer();
      await serverStarted.promise;
      const signingIn = login("founder@example.com", "password");
      await request.started.promise;
      request.respond({ token: "token-old-server" });
      const signInOutcome = await signingIn.then(
        () => "signed-in",
        (cause: unknown) => (cause instanceof Error ? cause.name : "unknown-error"),
      );
      releaseServer.resolve();
      const serverOutcome = await serverTransition.then(
        () => "success",
        () => "failure",
      );

      expect(signInOutcome).toBe("AbortError");
      expect(serverOutcome).toBe(transition.outcome);
      expect(getServer()?.baseUrl).toBe(
        transition.action === "set" && transition.outcome === "success"
          ? "https://replacement-pending-login.example.com"
          : transition.action === "clear" && transition.outcome === "success"
            ? undefined
            : previousServer,
      );
      expect(values.get(SERVER_KEY)).toBe(getServer()?.baseUrl);
      expect(getToken()).toBeNull();
      expect(values.has(TOKEN_KEY)).toBe(false);
    });
  }

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

  test("rejects a stale pairing HTTP error before classifying the old response", async () => {
    const request = deferredFetch();
    await setServer("https://old-pairing-error.example.com");
    const polling = pollPairing("device-code");
    await request.started.promise;
    await setServer("https://new-pairing-error.example.com");
    request.respond({ message: "old device code rejected" }, 400);

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not finish pairing after its screen aborts during token persistence", async () => {
    const request = deferredFetch();
    await setServer("https://pairing-cancel.example.com");
    const tokenStarted = deferred<void>();
    const releaseToken = deferred<void>();
    pendingTokenWrite = { started: tokenStarted, release: releaseToken };
    const controller = new AbortController();
    const polling = pollPairing("device-code", controller.signal);
    await request.started.promise;
    request.respond({ status: "approved", token: "abandoned-token" });
    await tokenStarted.promise;

    controller.abort();
    releaseToken.resolve();

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not finish login after its screen aborts the request", async () => {
    const request = deferredFetch();
    await setServer("https://login-cancel.example.com");
    const controller = new AbortController();
    const signingIn = login("founder@example.com", "password", controller.signal);
    await request.started.promise;

    controller.abort();
    request.respond({ token: "abandoned-token" });

    await expect(signingIn).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not finish TOTP verification after its screen aborts the request", async () => {
    const request = deferredFetch();
    await setServer("https://totp-cancel.example.com");
    const controller = new AbortController();
    const verifying = verifyTotp("mfa-token", "123456", controller.signal);
    await request.started.promise;

    controller.abort();
    request.respond({ token: "abandoned-token" });

    await expect(verifying).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
  });

  test("does not finish TOTP verification after aborting during token persistence", async () => {
    const request = deferredFetch();
    await setServer("https://totp-persistence-cancel.example.com");
    const tokenStarted = deferred<void>();
    const releaseToken = deferred<void>();
    pendingTokenWrite = { started: tokenStarted, release: releaseToken };
    const controller = new AbortController();
    const verifying = verifyTotp("mfa-token", "123456", controller.signal);
    await request.started.promise;
    request.respond({ token: "abandoned-token" });
    await tokenStarted.promise;

    controller.abort();
    releaseToken.resolve();

    await expect(verifying).rejects.toMatchObject({ name: "AbortError" });
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
    const request = deferredFetch();
    await setServer("https://old-logout.example.com");
    await hydrate("token-old", "workspace-old");
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
