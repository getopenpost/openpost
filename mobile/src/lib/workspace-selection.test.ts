import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { WorkspaceSelectionState } from "./workspace-selection";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

type StoreOperation = { kind: "set" | "delete"; key: string; value?: string };

const TOKEN_KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";
const SERVER_KEY = "openpost.server.baseUrl";
const values = new Map<string, string>();
let pendingWrite: (StoreOperation & { started: Deferred<void>; release: Deferred<void> }) | null =
  null;
let failingWrite: StoreOperation | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
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

const { clearServer, getServer, setServer } = await import("./server");
const { getWorkspaceId, loadToken, loadWorkspaceId, subscribeWorkspaceId } =
  await import("./api/token-store");
const { captureApiRequestIdentity, commitTokenForIdentity } = await import("./api/client");
const { automaticWorkspaceSelectionId, completeWorkspaceSelection, selectWorkspaceForNavigation } =
  await import("./workspace-selection");

describe("workspace selection", () => {
  beforeEach(async () => {
    pendingWrite = null;
    failingWrite = null;
    values.clear();
    await setServer("https://old.example.com");
    values.set(TOKEN_KEY, "token-current");
    values.set(WORKSPACE_KEY, "workspace-old");
    await loadToken();
    await loadWorkspaceId();
  });

  afterEach(() => {
    pendingWrite?.release.resolve();
    pendingWrite = null;
    failingWrite = null;
  });

  test("persists, publishes, and navigates for the current identity", async () => {
    const snapshots: (string | null)[] = [];
    const unsubscribe = subscribeWorkspaceId(() => snapshots.push(getWorkspaceId()));
    let navigationCount = 0;

    try {
      expect(
        await completeWorkspaceSelection("workspace-new", () => {
          navigationCount += 1;
        }),
      ).toBe(true);
      expect(navigationCount).toBe(1);
      expect(values.get(WORKSPACE_KEY)).toBe("workspace-new");
      expect(getWorkspaceId()).toBe("workspace-new");
      expect(snapshots).toEqual(["workspace-new"]);
    } finally {
      unsubscribe();
    }
  });

  test("does not persist, publish, or navigate after a server change queues", async () => {
    const workspaceStarted = deferred<void>();
    const releaseWorkspace = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: WORKSPACE_KEY,
      value: "workspace-stale",
      started: workspaceStarted,
      release: releaseWorkspace,
    };
    let navigationCount = 0;
    const selection = completeWorkspaceSelection("workspace-stale", () => {
      navigationCount += 1;
    });
    await workspaceStarted.promise;

    const serverStarted = deferred<void>();
    const releaseServer = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: SERVER_KEY,
      value: "https://new.example.com",
      started: serverStarted,
      release: releaseServer,
    };
    const serverChange = setServer("https://new.example.com");
    expect(getServer()?.baseUrl).toBe("https://old.example.com");
    releaseWorkspace.resolve();

    expect(await selection).toBe(false);
    expect(navigationCount).toBe(0);
    expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
    expect(getWorkspaceId()).toBe("workspace-old");

    await serverStarted.promise;
    releaseServer.resolve();
    await serverChange;
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(getWorkspaceId()).toBeNull();
  });

  for (const transition of [
    { action: "set", outcome: "success" },
    { action: "set", outcome: "failure" },
    { action: "clear", outcome: "success" },
    { action: "clear", outcome: "failure" },
  ] as const) {
    test(`does not select a Workspace during a pending server ${transition.action} ${transition.outcome}`, async () => {
      const started = deferred<void>();
      const release = deferred<void>();
      const serverOperation: StoreOperation =
        transition.action === "set"
          ? { kind: "set", key: SERVER_KEY, value: "https://pending.example.com" }
          : { kind: "delete", key: SERVER_KEY };
      pendingWrite = { ...serverOperation, started, release };
      if (transition.outcome === "failure") failingWrite = serverOperation;
      const serverTransition =
        transition.action === "set" ? setServer("https://pending.example.com") : clearServer();
      await started.promise;
      let navigationCount = 0;

      const selected = await completeWorkspaceSelection("workspace-new", () => {
        navigationCount += 1;
      });
      release.resolve();
      const serverOutcome = await serverTransition.then(
        () => "success",
        () => "failure",
      );

      expect(selected).toBe(false);
      expect(navigationCount).toBe(0);
      expect(serverOutcome).toBe(transition.outcome);
      if (transition.outcome === "success") {
        expect(getWorkspaceId()).toBeNull();
        expect(values.has(WORKSPACE_KEY)).toBe(false);
      } else {
        expect(getWorkspaceId()).toBe("workspace-old");
        expect(values.get(WORKSPACE_KEY)).toBe("workspace-old");
      }
    });
  }

  test("does not publish or navigate when a token change queues during its write", async () => {
    const workspaceStarted = deferred<void>();
    const releaseWorkspace = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: WORKSPACE_KEY,
      value: "workspace-stale",
      started: workspaceStarted,
      release: releaseWorkspace,
    };
    let navigationCount = 0;
    const selection = completeWorkspaceSelection("workspace-stale", () => {
      navigationCount += 1;
    });
    await workspaceStarted.promise;
    const newerLogin = commitTokenForIdentity("token-new", captureApiRequestIdentity());
    releaseWorkspace.resolve();

    expect(await selection).toBe(false);
    expect(await newerLogin).toBe(true);
    expect(navigationCount).toBe(0);
    expect(values.has(WORKSPACE_KEY)).toBe(false);
    expect(getWorkspaceId()).toBeNull();
  });

  test("manual storage failure resets the busy row and exposes a retry", async () => {
    failingWrite = { kind: "set", key: WORKSPACE_KEY, value: "workspace-manual" };
    const states: WorkspaceSelectionState[] = [];
    let navigationCount = 0;

    expect(
      await selectWorkspaceForNavigation(
        "workspace-manual",
        () => {
          navigationCount += 1;
        },
        (state) => states.push(state),
      ),
    ).toBe(false);

    expect(states).toEqual([
      { selected: "workspace-manual", error: null, retryWorkspaceId: null },
      {
        selected: null,
        error: "Could not select that workspace. Try again.",
        retryWorkspaceId: "workspace-manual",
      },
    ]);
    expect(navigationCount).toBe(0);
  });

  test("automatic rollback failure resets the busy row and exposes a retry", async () => {
    const automatic = automaticWorkspaceSelectionId(
      [{ id: "workspace-automatic" }],
      null,
      false,
      null,
    );
    expect(automatic).toBe("workspace-automatic");
    if (!automatic) throw new Error("Expected an automatic Workspace");
    const workspaceStarted = deferred<void>();
    const releaseWorkspace = deferred<void>();
    pendingWrite = {
      kind: "set",
      key: WORKSPACE_KEY,
      value: automatic,
      started: workspaceStarted,
      release: releaseWorkspace,
    };
    const states: WorkspaceSelectionState[] = [];
    const selection = selectWorkspaceForNavigation(
      automatic,
      () => undefined,
      (state) => states.push(state),
    );
    await workspaceStarted.promise;
    const serverChange = setServer("https://new.example.com");
    failingWrite = { kind: "set", key: WORKSPACE_KEY, value: "workspace-old" };
    releaseWorkspace.resolve();

    expect(await selection).toBe(false);
    expect(states.at(-1)).toEqual({
      selected: null,
      error: "Could not select that workspace. Try again.",
      retryWorkspaceId: "workspace-automatic",
    });
    await serverChange;
  });
});

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
