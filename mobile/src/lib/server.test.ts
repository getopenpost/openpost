import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const values = new Map<string, string>();
let serverRead: { started: Deferred<void>; release: Deferred<void>; value: string | null } | null =
  null;
let serverWrite: {
  operation: "delete" | "set";
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;
let failingServerValue: string | null = null;
let failingServerDelete = false;

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
    const pending =
      key === "openpost.server.baseUrl" && serverWrite?.operation === "set" ? serverWrite : null;
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
    const pending =
      key === "openpost.server.baseUrl" && serverWrite?.operation === "delete" ? serverWrite : null;
    if (pending) {
      serverWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (key === "openpost.server.baseUrl" && failingServerDelete) {
      failingServerDelete = false;
      throw new Error("SecureStore delete failed");
    }
    values.delete(key);
  },
}));

const {
  clearServer,
  getPendingServerMutationCount,
  getServer,
  getServerMutationRevision,
  loadServer,
  setServer,
} = await import("./server");

describe("server persistence", () => {
  beforeEach(async () => {
    serverRead = null;
    serverWrite = null;
    failingServerValue = null;
    failingServerDelete = false;
    await clearServer();
    values.clear();
  });

  afterEach(() => {
    serverRead?.release.resolve();
    serverWrite?.release.resolve();
    failingServerValue = null;
    failingServerDelete = false;
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
    serverWrite = { operation: "set", started, release };
    const previousRevision = getServerMutationRevision();

    const setting = setServer("https://queued.example.com");
    expect(getServerMutationRevision()).toBe(previousRevision + 1);
    expect(getPendingServerMutationCount()).toBe(1);
    await started.promise;
    expect(getServer()).toBeNull();

    release.resolve();
    await setting;
    expect(getPendingServerMutationCount()).toBe(0);
  });

  for (const outcome of ["success", "failure"] as const) {
    test(`tracks a pending server clear through ${outcome}`, async () => {
      await setServer("https://clear-pending.example.com");
      const started = deferred<void>();
      const release = deferred<void>();
      serverWrite = { operation: "delete", started, release };
      failingServerDelete = outcome === "failure";

      const clearing = clearServer();
      expect(getPendingServerMutationCount()).toBe(1);
      await started.promise;
      expect(getPendingServerMutationCount()).toBe(1);
      release.resolve();
      const actualOutcome = await clearing.then(
        () => "success",
        () => "failure",
      );

      expect(actualOutcome).toBe(outcome);
      expect(getPendingServerMutationCount()).toBe(0);
      expect(getServer()?.baseUrl).toBe(
        outcome === "success" ? undefined : "https://clear-pending.example.com",
      );
    });
  }

  test("repairs a superseded write before a newer failing write runs", async () => {
    await setServer("https://old.example.com");
    const started = deferred<void>();
    const release = deferred<void>();
    serverWrite = { operation: "set", started, release };

    const staleSetting = setServer("https://stale.example.com");
    await started.promise;
    failingServerValue = "https://failed.example.com";
    const newerSetting = setServer(failingServerValue);
    const newerOutcome = newerSetting.then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(getPendingServerMutationCount()).toBe(2);
    release.resolve();

    await expect(staleSetting).rejects.toMatchObject({ name: "AbortError" });
    expect(await newerOutcome).toMatchObject({ message: "SecureStore set failed" });
    expect(getPendingServerMutationCount()).toBe(0);
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
