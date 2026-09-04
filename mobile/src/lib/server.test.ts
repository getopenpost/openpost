import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const values = new Map<string, string>();
const SERVER_KEY = "openpost.server.baseUrl";
const TOKEN_KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const TRANSACTION_KEY = "openpost.identity.pending";
let serverRead: { started: Deferred<void>; release: Deferred<void>; value: string | null } | null =
  null;
let serverWrite: {
  operation: "delete" | "set";
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;
let failingServerValue: string | null = null;
let failingServerDelete = false;
let failingDeleteKey: string | null = null;

const secureStore = {
  getItemAsync: async (key: string) => {
    const pending = key === SERVER_KEY ? serverRead : null;
    if (pending) {
      serverRead = null;
      pending.started.resolve();
      await pending.release.promise;
      return pending.value;
    }
    return values.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    const pending = key === SERVER_KEY && serverWrite?.operation === "set" ? serverWrite : null;
    if (pending) {
      serverWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === SERVER_KEY && value === failingServerValue) {
      throw new Error("SecureStore set failed");
    }
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    const pending = key === SERVER_KEY && serverWrite?.operation === "delete" ? serverWrite : null;
    if (pending) {
      serverWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === SERVER_KEY && failingServerDelete) {
      failingServerDelete = false;
      throw new Error("SecureStore delete failed");
    }
    if (key === failingDeleteKey) {
      failingDeleteKey = null;
      throw new Error("SecureStore cleanup failed");
    }
    values.delete(key);
  },
};

mock.module("expo-secure-store", () => secureStore);

const { clearServer, getServer, loadServer, setServer } = await import("./server");
const { createIdentityStore } = await import("./identity-store");
const { getToken, getWorkspaceId, loadToken, loadWorkspaceId } = await import("./api/token-store");

describe("server persistence", () => {
  beforeEach(async () => {
    serverRead = null;
    serverWrite = null;
    failingServerValue = null;
    failingServerDelete = false;
    failingDeleteKey = null;
    await clearServer();
    values.clear();
  });

  afterEach(() => {
    serverRead?.release.resolve();
    serverWrite?.release.resolve();
    failingServerValue = null;
    failingServerDelete = false;
    failingDeleteKey = null;
  });

  test("switches servers atomically once the replacement is durable", async () => {
    await setServer("https://social.example.com");

    expect(await loadServer()).toEqual({
      baseUrl: "https://social.example.com",
      isHosted: false,
    });
    expect(values.get(SERVER_KEY)).toBe("https://social.example.com");

    values.set(TOKEN_KEY, "token-old");
    values.set(WORKSPACE_KEY, "workspace-old");
    await loadToken();
    await loadWorkspaceId();

    await setServer("https://new-session.example.com");

    expect(getServer()?.baseUrl).toBe("https://new-session.example.com");
    expect(getToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
    expect(values.get(SERVER_KEY)).toBe("https://new-session.example.com");
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("restores the whole identity when a replacement server cannot be stored", async () => {
    await setServer("https://old-restored.example.com");
    values.set(TOKEN_KEY, "token-old");
    values.set(WORKSPACE_KEY, "workspace-old");
    await loadToken();
    await loadWorkspaceId();
    failingServerValue = "https://failed-restored.example.com";

    await expect(setServer(failingServerValue)).rejects.toThrow("SecureStore set failed");

    expect(getServer()?.baseUrl).toBe("https://old-restored.example.com");
    expect(getToken()).toBe("token-old");
    expect(getWorkspaceId()).toBe("workspace-old");
    expect(values.get(SERVER_KEY)).toBe("https://old-restored.example.com");
    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("quarantines an interrupted server change and retries until clean", async () => {
    const seedInterruptedChange = () => {
      values.set(SERVER_KEY, "https://aborted-server.example.com");
      values.set(TOKEN_KEY, "token-from-old-server");
      values.set(WORKSPACE_KEY, "workspace-from-old-server");
      values.set(TRANSACTION_KEY, "server");
    };

    seedInterruptedChange();
    const restarted = createIdentityStore(secureStore);

    expect(await restarted.loadServerBaseUrl()).toBeNull();
    expect(await restarted.loadToken()).toBeNull();
    expect(await restarted.loadWorkspaceId()).toBeNull();
    expect(values.has(SERVER_KEY)).toBe(false);
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);

    // A failed quarantine delete retries on the next startup instead of
    // leaving residue behind.
    seedInterruptedChange();
    failingServerDelete = true;

    const firstRestart = createIdentityStore(secureStore);
    expect(await firstRestart.loadServerBaseUrl()).toBeNull();
    expect(values.get(SERVER_KEY)).toBe("https://aborted-server.example.com");
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("server");

    const secondRestart = createIdentityStore(secureStore);
    expect(await secondRestart.loadServerBaseUrl()).toBeNull();
    expect(values.has(SERVER_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);

    // A commit attempted while recovery is incomplete aborts and keeps the
    // trusted server instead of snapshotting residue.
    values.set(SERVER_KEY, "https://trusted-server.example.com");
    values.set(TOKEN_KEY, "quarantined-token");
    values.set(WORKSPACE_KEY, "quarantined-workspace");
    values.set(TRANSACTION_KEY, "session");
    failingDeleteKey = TOKEN_KEY;
    failingServerValue = "https://replacement-after-recovery.example.com";
    const interrupted = createIdentityStore(secureStore);

    await expect(
      interrupted.commitServerBaseUrl("https://replacement-after-recovery.example.com"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(values.get(SERVER_KEY)).toBe("https://trusted-server.example.com");
    expect(values.get(TOKEN_KEY)).toBe("quarantined-token");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");

    failingServerValue = null;
    const recovered = createIdentityStore(secureStore);
    expect(await recovered.loadServerBaseUrl()).toBe("https://trusted-server.example.com");
    expect(await recovered.loadToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("suppresses stale loads and superseded writes during a server change", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    serverRead = { started, release, value: "https://old.example.com" };

    const loading = loadServer();
    await started.promise;
    const setting = setServer("https://new.example.com");
    release.resolve();

    expect(await loading).toBeNull();
    await setting;
    expect(getServer()?.baseUrl).toBe("https://new.example.com");
    expect(values.get(SERVER_KEY)).toBe("https://new.example.com");

    // A superseded write aborts instead of racing the newer failing write,
    // and the last durable server wins.
    await setServer("https://old.example.com");
    const writeStarted = deferred<void>();
    const writeRelease = deferred<void>();
    serverWrite = { operation: "set", started: writeStarted, release: writeRelease };

    const staleSetting = setServer("https://stale.example.com");
    await writeStarted.promise;
    failingServerValue = "https://failed.example.com";
    const newerSetting = setServer(failingServerValue);
    const newerOutcome = newerSetting.then(
      () => null,
      (cause: unknown) => cause,
    );
    writeRelease.resolve();

    await expect(staleSetting).rejects.toMatchObject({ name: "AbortError" });
    expect(await newerOutcome).toMatchObject({ message: "SecureStore set failed" });
    expect(values.get(SERVER_KEY)).toBe("https://old.example.com");
    expect(getServer()?.baseUrl).toBe("https://old.example.com");
  });
});

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
