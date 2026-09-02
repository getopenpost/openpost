import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const values = new Map<string, string>();
let serverRead: { started: Deferred<void>; release: Deferred<void>; value: string | null } | null =
  null;
let serverWrite: { started: Deferred<void>; release: Deferred<void> } | null = null;
let failingServerValue: string | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => {
    const pending = key === "openpost.server.baseUrl" ? serverRead : null;
    if (pending) {
      serverRead = null;
      pending.started.resolve();
      await pending.release.promise;
      return pending.value;
    }
    return values.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    const pending = key === "openpost.server.baseUrl" ? serverWrite : null;
    if (pending) {
      serverWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === "openpost.server.baseUrl" && value === failingServerValue) {
      throw new Error("SecureStore set failed");
    }
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    values.delete(key);
  },
}));

const { clearServer, getServer, getServerMutationRevision, loadServer, setServer } =
  await import("./server");

describe("server persistence", () => {
  beforeEach(async () => {
    serverRead = null;
    serverWrite = null;
    failingServerValue = null;
    await clearServer();
    values.clear();
  });

  afterEach(() => {
    serverRead?.release.resolve();
    serverWrite?.release.resolve();
    failingServerValue = null;
  });

  test("preserves self-hosted servers", async () => {
    await setServer("https://social.example.com");

    expect(await loadServer()).toEqual({
      baseUrl: "https://social.example.com",
      isHosted: false,
    });
    expect(values.get("openpost.server.baseUrl")).toBe("https://social.example.com");
  });

  test("does not publish an old load after a newer server change queues", async () => {
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
    expect(values.get("openpost.server.baseUrl")).toBe("https://new.example.com");
  });

  test("exposes a queued server mutation before its durable write finishes", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    serverWrite = { started, release };
    const previousRevision = getServerMutationRevision();

    const setting = setServer("https://queued.example.com");
    expect(getServerMutationRevision()).toBe(previousRevision + 1);
    await started.promise;
    expect(getServer()).toBeNull();

    release.resolve();
    await setting;
  });

  test("repairs a superseded write before a newer failing write runs", async () => {
    await setServer("https://old.example.com");
    const started = deferred<void>();
    const release = deferred<void>();
    serverWrite = { started, release };

    const staleSetting = setServer("https://stale.example.com");
    await started.promise;
    failingServerValue = "https://failed.example.com";
    const newerSetting = setServer(failingServerValue);
    release.resolve();

    await expect(staleSetting).rejects.toMatchObject({ name: "AbortError" });
    await expect(newerSetting).rejects.toThrow("SecureStore set failed");
    expect(values.get("openpost.server.baseUrl")).toBe("https://old.example.com");
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
