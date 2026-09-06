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
const TRANSACTION_KEY = "openpost.identity.pending";
const values = new Map<string, string>();
let pendingRead: {
  key: string;
  value: string | null;
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;
let pendingWrite: (StoreOperation & { started: Deferred<void>; release: Deferred<void> }) | null =
  null;
let failingWrites: StoreOperation[] = [];

const secureStore = {
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
};

mock.module("expo-secure-store", () => secureStore);

const { setServer } = await import("../server");
const { createIdentityStore } = await import("../identity-store");
const {
  commitTokenIfCurrent,
  getPendingTokenMutationCount,
  getToken,
  getTokenMutationRevision,
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
    failingWrites = [];
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
    failingWrites = [];
  });

  test("publishes token changes only after both keys are durable", async () => {
    const tokenSnapshots: (string | null)[] = [];
    const tokenPendingSnapshots: number[] = [];
    const workspaceSnapshots: (string | null)[] = [];
    const unsubscribeToken = subscribeToken(() => {
      tokenSnapshots.push(getToken());
      tokenPendingSnapshots.push(getPendingTokenMutationCount());
    });
    const unsubscribeWorkspace = subscribeWorkspaceId(() =>
      workspaceSnapshots.push(getWorkspaceId()),
    );

    try {
      expect(await commitTokenForIdentity("token-1", captureApiRequestIdentity())).toBe(true);
      expect(values.get(TOKEN_KEY)).toBe("token-1");
      expect(getToken()).toBe("token-1");
      expect(tokenSnapshots).toEqual(["token-1"]);
      expect(tokenPendingSnapshots).toEqual([0]);
      expect(workspaceSnapshots).toEqual([null]);

      expect(await clearTokenForIdentity(captureApiRequestIdentity())).toBe(true);
      expect(values.has(TOKEN_KEY)).toBe(false);
      expect(getToken()).toBeNull();
      expect(tokenSnapshots).toEqual(["token-1", null]);
      expect(tokenPendingSnapshots).toEqual([0, 0]);
    } finally {
      unsubscribeToken();
      unsubscribeWorkspace();
    }
  });

  test("repairs the token when clearing the Workspace key fails", async () => {
    await hydrate("token-old", "workspace-old");
    failingWrites.push({ kind: "delete", key: WORKSPACE_KEY });

    await expect(commitTokenForIdentity("token-new", captureApiRequestIdentity())).rejects.toThrow(
      "SecureStore write failed",
    );

    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(getToken()).toBe("token-old");
    expect(getWorkspaceId()).toBe("workspace-old");
  });

  test("does not write identity keys when the session marker cannot become durable", async () => {
    await hydrate("token-old", "workspace-old");
    failingWrites.push({ kind: "set", key: TRANSACTION_KEY, value: "session" });

    await expect(commitTokenForIdentity("token-new", captureApiRequestIdentity())).rejects.toThrow(
      "SecureStore write failed",
    );

    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("does not restore quarantined session residue when a retry cannot clean it", async () => {
    values.set(TOKEN_KEY, "token-residue");
    values.set(WORKSPACE_KEY, "workspace-residue");
    values.set(TRANSACTION_KEY, "session");
    failingWrites.push({ kind: "delete", key: TOKEN_KEY });

    expect(await commitTokenForIdentity("token-retry", captureApiRequestIdentity())).toBe(false);

    expect(values.get(TOKEN_KEY)).toBe("token-residue");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");
    expect(getToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
    await expectFreshRestartHydration(null, null);
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("invalidates a token commit queued while startup discovers a marked session", async () => {
    values.set(TOKEN_KEY, "token-residue");
    values.set(WORKSPACE_KEY, "workspace-residue");
    values.set(TRANSACTION_KEY, "session");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingRead = {
      key: TRANSACTION_KEY,
      value: "session",
      started,
      release,
    };

    const loading = loadToken();
    await started.promise;
    const committing = commitTokenForIdentity("token-retry", captureApiRequestIdentity());
    release.resolve();

    expect(await loading).toBeNull();
    expect(await committing).toBe(false);
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("clears the Workspace before a replacement token can become durable", async () => {
    await hydrate("token-old", "workspace-old");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: TOKEN_KEY,
      value: "token-new",
      started,
      release,
    };

    const committing = commitTokenForIdentity("token-new", captureApiRequestIdentity());
    await started.promise;

    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");
    release.resolve();

    expect(await committing).toBe(true);
    expect(values.get(TOKEN_KEY)).toBe("token-new");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("keeps the session marker until a replacement token is ready to publish", async () => {
    await hydrate("token-old", "workspace-old");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingWrite = { kind: "delete", key: TRANSACTION_KEY, started, release };

    const committing = commitTokenForIdentity("token-new", captureApiRequestIdentity());
    await started.promise;

    expect(values.get(TOKEN_KEY)).toBe("token-new");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");
    expect(getToken()).toBe("token-old");
    release.resolve();

    expect(await committing).toBe(true);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
    expect(getToken()).toBe("token-new");
  });

  test("does not publish or restore a token across a server intent during marker deletion", async () => {
    await hydrate("token-old", "workspace-old");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingWrite = { kind: "delete", key: TRANSACTION_KEY, started, release };

    const committing = commitTokenForIdentity("token-stale", captureApiRequestIdentity());
    await started.promise;
    const changingServer = setServer("https://replacement-during-token-marker.example.com");
    release.resolve();

    expect(await committing).toBe(false);
    await changingServer;
    expect(values.get("openpost.server.baseUrl")).toBe(
      "https://replacement-during-token-marker.example.com",
    );
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
    expect(getToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
  });

  test("fails closed when the committed session marker cannot be cleared", async () => {
    await hydrate("token-old", "workspace-old");
    failingWrites.push({ kind: "delete", key: TRANSACTION_KEY });

    await expect(commitTokenForIdentity("token-new", captureApiRequestIdentity())).rejects.toThrow(
      "SecureStore write failed",
    );

    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(getToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
    await expectFreshRestartHydration(null, null);
  });

  test("keeps the session marker through a superseded token rollback", async () => {
    await hydrate("token-old", "workspace-old");
    const tokenStarted = deferred<void>();
    const releaseToken = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: TOKEN_KEY,
      value: "token-stale",
      started: tokenStarted,
      release: releaseToken,
    };

    let identityIsCurrent = true;
    const staleCommit = commitTokenIfCurrent(
      "token-stale",
      "token-old",
      getTokenMutationRevision(),
      () => identityIsCurrent,
    );
    await tokenStarted.promise;
    identityIsCurrent = false;
    const workspaceRestoreStarted = deferred<void>();
    const releaseWorkspaceRestore = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: WORKSPACE_KEY,
      value: "workspace-old",
      started: workspaceRestoreStarted,
      release: releaseWorkspaceRestore,
    };
    releaseToken.resolve();
    await workspaceRestoreStarted.promise;

    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");
    releaseWorkspaceRestore.resolve();

    expect(await staleCommit).toBe(false);
    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("quarantines token state when its rollback cannot restore a superseded token", async () => {
    await hydrate("token-old", "workspace-old");
    const started = deferred<void>();
    const release = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: TOKEN_KEY,
      value: "token-new",
      started,
      release,
    };

    let identityIsCurrent = true;
    const staleCommit = commitTokenIfCurrent(
      "token-new",
      "token-old",
      getTokenMutationRevision(),
      () => identityIsCurrent,
    );
    await started.promise;
    identityIsCurrent = false;
    failingWrites.push(
      { kind: "set", key: TOKEN_KEY, value: "token-old" },
      { kind: "delete", key: TOKEN_KEY },
    );
    release.resolve();

    await expect(staleCommit).rejects.toThrow("Could not restore or clear the stored session");

    expect(values.get(TOKEN_KEY)).toBe("token-new");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");
    expect(getToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
    await expectFreshRestartHydration(null, null);
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
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
    failingWrites.push({ kind: "set", key: TOKEN_KEY, value: "token-failed" });
    const newerCommit = commitTokenForIdentity("token-failed", newerIdentity);
    release.resolve();

    expect(await staleCommit).toBe(false);
    await expect(newerCommit).rejects.toThrow("SecureStore write failed");
    expect(values.get(TOKEN_KEY)).toBe("token-old");
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(getToken()).toBe("token-old");
    expect(getWorkspaceId()).toBe("workspace-old");
  });

  for (const crashState of [
    {
      name: "after clearing the old Workspace",
      token: "token-old",
      workspaceId: null,
      transaction: "session",
      expectedToken: null,
      expectedWorkspaceId: null,
    },
    {
      name: "after making the replacement token durable",
      token: "token-new",
      workspaceId: null,
      transaction: "session",
      expectedToken: null,
      expectedWorkspaceId: null,
    },
    {
      name: "while restoring the old session",
      token: "token-old",
      workspaceId: null,
      transaction: "session",
      expectedToken: null,
      expectedWorkspaceId: null,
    },
    {
      name: "after restoring the old keys but before committing the rollback",
      token: "token-old",
      workspaceId: "workspace-old",
      transaction: "session",
      expectedToken: null,
      expectedWorkspaceId: null,
    },
    {
      name: "after committing the old session rollback",
      token: "token-old",
      workspaceId: "workspace-old",
      transaction: null,
      expectedToken: "token-old",
      expectedWorkspaceId: "workspace-old",
    },
  ]) {
    test(`fresh startup is safe ${crashState.name}`, async () => {
      writeValue(TOKEN_KEY, crashState.token);
      writeValue(WORKSPACE_KEY, crashState.workspaceId);
      writeValue(TRANSACTION_KEY, crashState.transaction);

      await expectFreshRestartHydration(crashState.expectedToken, crashState.expectedWorkspaceId);
    });
  }

  test("a fresh Workspace load independently refuses a marked session", async () => {
    values.set(TOKEN_KEY, "token-new");
    values.set(WORKSPACE_KEY, "workspace-old");
    values.set(TRANSACTION_KEY, "session");
    const restarted = await importFreshTokenStore();

    expect(await restarted.loadWorkspaceId()).toBeNull();
    expect(restarted.getToken()).toBeNull();
    expect(restarted.getWorkspaceId()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
  });

  test("a fresh startup keeps the token but refuses a marked Workspace", async () => {
    values.set(TOKEN_KEY, "token-current");
    values.set(WORKSPACE_KEY, "workspace-stale");
    values.set(TRANSACTION_KEY, "workspace");

    await expectFreshRestartHydration("token-current", null);
    expect(values.get(TOKEN_KEY)).toBe("token-current");
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.has(TRANSACTION_KEY)).toBe(false);
  });

  test("a later startup retries recovery when the transaction marker could not be cleared", async () => {
    values.set(TOKEN_KEY, "token-new");
    values.set(WORKSPACE_KEY, "workspace-old");
    values.set(TRANSACTION_KEY, "session");
    failingWrites.push({ kind: "delete", key: TRANSACTION_KEY });
    const firstRestart = await importFreshTokenStore();

    expect(await firstRestart.loadToken()).toBeNull();
    expect(values.has(TOKEN_KEY)).toBe(false);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(values.get(TRANSACTION_KEY)).toBe("session");

    const secondRestart = await importFreshTokenStore();
    expect(await secondRestart.loadToken()).toBeNull();
    expect(values.has(TRANSACTION_KEY)).toBe(false);
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
  const failureIndex = failingWrites.findIndex((failure) => matches(failure, operation));
  if (failureIndex === -1) return;
  failingWrites.splice(failureIndex, 1);
  throw new Error("SecureStore write failed");
}

async function expectFreshRestartHydration(
  expectedToken: string | null,
  expectedWorkspaceId: string | null,
): Promise<void> {
  const restarted = await importFreshTokenStore();
  expect(await restarted.loadToken()).toBe(expectedToken);
  expect(await restarted.loadWorkspaceId()).toBe(expectedWorkspaceId);
  expect(restarted.getToken()).toBe(expectedToken);
  expect(restarted.getWorkspaceId()).toBe(expectedWorkspaceId);
}

async function importFreshTokenStore(): Promise<ReturnType<typeof createIdentityStore>> {
  const restarted = createIdentityStore(secureStore);
  expect(restarted.getToken).not.toBe(getToken);
  return restarted;
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
