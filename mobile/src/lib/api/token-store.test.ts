import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

type StoreOperation = {
  kind: "delete" | "set";
  key: string;
  value?: string;
};

const TOKEN_KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const values = new Map<string, string>();
let pendingRead: {
  key: string;
  value: string | null;
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;
let pendingWrite: (StoreOperation & { started: Deferred<void>; release: Deferred<void> }) | null =
  null;
let failingWrite: StoreOperation | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => {
    const pending = pendingRead?.key === key ? pendingRead : null;
    if (pending) {
      pendingRead = null;
      pending.started.resolve();
      await pending.release.promise;
      return pending.value;
    }
    return values.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    await pauseWrite({ kind: "set", key, value });
    failWrite({ kind: "set", key, value });
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    await pauseWrite({ kind: "delete", key });
    failWrite({ kind: "delete", key });
    values.delete(key);
  },
}));

const { setServer } = await import("../server");
const {
  getToken,
  getWorkspaceId,
  loadToken,
  loadWorkspaceId,
  subscribeToken,
  subscribeWorkspaceId,
} = await import("./token-store");
const {
  captureApiRequestIdentity,
  clearTokenForIdentity,
  commitTokenForIdentity,
  commitWorkspaceIdForIdentity,
} = await import("./client");

describe("token and Workspace persistence", () => {
  beforeEach(async () => {
    pendingRead = null;
    pendingWrite = null;
    failingWrite = null;
    values.clear();
    await loadToken();
    await loadWorkspaceId();
    await setServer("https://identity.example.com");
  });

  afterEach(() => {
    pendingRead?.release.resolve();
    pendingWrite?.release.resolve();
    pendingRead = null;
    pendingWrite = null;
    failingWrite = null;
  });

  test("publishes token changes only after both keys are durable", async () => {
    const tokenSnapshots: (string | null)[] = [];
    const workspaceSnapshots: (string | null)[] = [];
    const unsubscribeToken = subscribeToken(() => tokenSnapshots.push(getToken()));
    const unsubscribeWorkspace = subscribeWorkspaceId(() =>
      workspaceSnapshots.push(getWorkspaceId()),
    );

    try {
      expect(await commitTokenForIdentity("token-1", captureApiRequestIdentity())).toBe(true);
      expect(values.get(TOKEN_KEY)).toBe("token-1");
      expect(getToken()).toBe("token-1");
      expect(tokenSnapshots).toEqual(["token-1"]);
      expect(workspaceSnapshots).toEqual([null]);

      expect(await clearTokenForIdentity(captureApiRequestIdentity())).toBe(true);
      expect(values.has(TOKEN_KEY)).toBe(false);
      expect(getToken()).toBeNull();
      expect(tokenSnapshots).toEqual(["token-1", null]);
    } finally {
      unsubscribeToken();
      unsubscribeWorkspace();
    }
  });

  test("persists and publishes a cleared preferred Workspace", async () => {
    await hydrate("token-current", "workspace-current");

    expect(await commitWorkspaceIdForIdentity(null, captureApiRequestIdentity())).toBe(true);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(getWorkspaceId()).toBeNull();
  });

  test("repairs the token when clearing the Workspace key fails", async () => {
    await hydrate("token-old", "workspace-old");
    failingWrite = { kind: "delete", key: WORKSPACE_KEY };

    await expect(commitTokenForIdentity("token-new", captureApiRequestIdentity())).rejects.toThrow(
      "SecureStore write failed",
    );

    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(getToken()).toBe("token-old");
    expect(getWorkspaceId()).toBe("workspace-old");
  });

  test("does not publish an old token load after a newer token commit queues", async () => {
    values.set(TOKEN_KEY, "token-old");
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeToken(() => snapshots.push(getToken()));
    const started = deferred<void>();
    const release = deferred<void>();
    pendingRead = { key: TOKEN_KEY, value: "token-old", started, release };

    try {
      const loading = loadToken();
      await started.promise;
      const saving = commitTokenForIdentity("token-new", captureApiRequestIdentity());
      release.resolve();

      expect(await loading).toBeNull();
      expect(await saving).toBe(true);
      expect(snapshots).toEqual(["token-new"]);
      expect(getToken()).toBe("token-new");
      expect(values.get(TOKEN_KEY)).toBe("token-new");
    } finally {
      release.resolve();
      unsubscribe();
    }
  });

  test("does not publish an old Workspace load after a newer selection queues", async () => {
    await hydrate("token-current", "workspace-current");
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
    const started = deferred<void>();
    const release = deferred<void>();
    pendingRead = { key: WORKSPACE_KEY, value: "workspace-old", started, release };

    try {
      const loading = loadWorkspaceId();
      await started.promise;
      const saving = commitWorkspaceIdForIdentity("workspace-new", captureApiRequestIdentity());
      release.resolve();

      expect(await loading).toBe("workspace-current");
      expect(await saving).toBe(true);
      expect(snapshots).toEqual(["workspace-new"]);
      expect(getWorkspaceId()).toBe("workspace-new");
      expect(values.get(WORKSPACE_KEY)).toBe("workspace-new");
    } finally {
      release.resolve();
      unsubscribe();
    }
  });

  test("does not publish an old Workspace load after a token change queues", async () => {
    await hydrate("token-current", "workspace-current");
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
    const started = deferred<void>();
    const release = deferred<void>();
    pendingRead = { key: WORKSPACE_KEY, value: "workspace-old", started, release };

    try {
      const loading = loadWorkspaceId();
      await started.promise;
      const saving = commitTokenForIdentity("token-new", captureApiRequestIdentity());
      release.resolve();

      expect(await loading).toBe("workspace-current");
      expect(await saving).toBe(true);
      expect(snapshots).toEqual([null]);
      expect(getWorkspaceId()).toBeNull();
      expect(values.has(WORKSPACE_KEY)).toBe(false);
    } finally {
      release.resolve();
      unsubscribe();
    }
  });

  test("lets a token commit win over a Workspace selection queued behind it", async () => {
    await hydrate("token-old", "workspace-old");
    const tokenStarted = deferred<void>();
    const releaseToken = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: TOKEN_KEY,
      value: "token-new",
      started: tokenStarted,
      release: releaseToken,
    };

    const tokenCommit = commitTokenForIdentity("token-new", captureApiRequestIdentity());
    await tokenStarted.promise;
    const workspaceCommit = commitWorkspaceIdForIdentity(
      "workspace-stale",
      captureApiRequestIdentity(),
    );
    releaseToken.resolve();

    expect(await tokenCommit).toBe(true);
    expect(await workspaceCommit).toBe(false);
    expect(getToken()).toBe("token-new");
    expect(getWorkspaceId()).toBeNull();
    expect(values.get(TOKEN_KEY)).toBe("token-new");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
  });

  test("repairs a superseded token write before a newer failing write runs", async () => {
    await hydrate("token-old", "workspace-old");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingWrite = { kind: "set", key: TOKEN_KEY, value: "token-stale", started, release };

    const staleCommit = commitTokenForIdentity("token-stale", captureApiRequestIdentity());
    await started.promise;
    const newerIdentity = captureApiRequestIdentity();
    failingWrite = { kind: "set", key: TOKEN_KEY, value: "token-failed" };
    const newerCommit = commitTokenForIdentity("token-failed", newerIdentity);
    release.resolve();

    expect(await staleCommit).toBe(false);
    await expect(newerCommit).rejects.toThrow("SecureStore write failed");
    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(getToken()).toBe("token-old");
    expect(getWorkspaceId()).toBe("workspace-old");
  });

  test("repairs a superseded Workspace write before a newer failing write runs", async () => {
    await hydrate("token-current", "workspace-old");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: WORKSPACE_KEY,
      value: "workspace-stale",
      started,
      release,
    };

    const staleCommit = commitWorkspaceIdForIdentity(
      "workspace-stale",
      captureApiRequestIdentity(),
    );
    await started.promise;
    const newerIdentity = captureApiRequestIdentity();
    failingWrite = { kind: "set", key: WORKSPACE_KEY, value: "workspace-failed" };
    const newerCommit = commitWorkspaceIdForIdentity("workspace-failed", newerIdentity);
    release.resolve();

    expect(await staleCommit).toBe(false);
    await expect(newerCommit).rejects.toThrow("SecureStore write failed");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(getWorkspaceId()).toBe("workspace-old");
  });
});

async function hydrate(nextToken: string | null, nextWorkspaceId: string | null): Promise<void> {
  writeValue(TOKEN_KEY, nextToken);
  writeValue(WORKSPACE_KEY, nextWorkspaceId);
  await loadToken();
  await loadWorkspaceId();
}

function writeValue(key: string, value: string | null): void {
  if (value) values.set(key, value);
  else values.delete(key);
}

async function pauseWrite(operation: StoreOperation): Promise<void> {
  const pending = pendingWrite;
  if (!pending || !matches(pending, operation)) return;
  pendingWrite = null;
  pending.started.resolve();
  await pending.release.promise;
}

function failWrite(operation: StoreOperation): void {
  const failure = failingWrite;
  if (!failure || !matches(failure, operation)) return;
  failingWrite = null;
  throw new Error("SecureStore write failed");
}

function matches(expected: StoreOperation, actual: StoreOperation): boolean {
  return (
    expected.kind === actual.kind &&
    expected.key === actual.key &&
    (expected.value === undefined || expected.value === actual.value)
  );
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
