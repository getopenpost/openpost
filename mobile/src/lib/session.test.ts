import { afterEach, describe, expect, mock, test } from "bun:test";
import { openPostBootstrapQueryKeys, type AppBootstrap } from "@openpost/query-catalog";
import { QueryClient } from "@tanstack/react-query";

import {
  loadSessionState,
  synchronizeSession,
  type SessionLoaders,
  type SessionSynchronizer,
} from "./session";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

const storedIdentity = new Map<string, string>();
let pendingTokenWrite: { started: Deferred<void>; release: Deferred<void> } | null = null;
let pendingWorkspaceWrite: {
  operation: "delete" | "set";
  started: Deferred<void>;
  release: Deferred<void>;
} | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => storedIdentity.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    const pending = key === "openpost.auth.token" ? pendingTokenWrite : null;
    if (pending) {
      pendingTokenWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    const workspacePending =
      key === "openpost.workspace.id" && pendingWorkspaceWrite?.operation === "set"
        ? pendingWorkspaceWrite
        : null;
    if (workspacePending) {
      pendingWorkspaceWrite = null;
      workspacePending.started.resolve();
      await workspacePending.release.promise;
    }
    storedIdentity.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    const pending =
      key === "openpost.workspace.id" && pendingWorkspaceWrite?.operation === "delete"
        ? pendingWorkspaceWrite
        : null;
    if (pending) {
      pendingWorkspaceWrite = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    storedIdentity.delete(key);
  },
}));

const { getServer, setServer } = await import("./server");
const { getToken, getWorkspaceId, loadToken, loadWorkspaceId } = await import("./api/token-store");
const {
  apiRequestIdentityIsCurrent,
  captureApiRequestIdentity,
  clearTokenForIdentity,
  commitTokenForIdentity,
  commitWorkspaceIdForIdentity,
} = await import("./api/client");

test("restores the selected workspace before a signed-in session becomes ready", async () => {
  let workspaceId: string | null = null;
  const loaders: SessionLoaders = {
    loadServer: async () => undefined,
    loadToken: async () => undefined,
    loadWorkspaceId: async () => {
      workspaceId = "workspace-1";
    },
    getServer: () => ({ baseUrl: "https://app.openpo.st" }),
    getToken: () => "token",
    getWorkspaceId: () => workspaceId,
  };

  const session = await loadSessionState(loaders);

  expect(session).toEqual({
    serverReady: true,
    signedIn: true,
    workspaceId: "workspace-1",
  });
});

describe("authenticated session bootstrap", () => {
  afterEach(() => {
    pendingTokenWrite?.release.resolve();
    pendingWorkspaceWrite?.release.resolve();
    pendingTokenWrite = null;
    pendingWorkspaceWrite = null;
  });

  test("reuses a fresh bootstrap result for the same session and preference", async () => {
    const queryClient = new QueryClient();
    const state = synchronizer(queryClient, { bootstrap: bootstrap() });

    await synchronizeSession(state.dependencies, new AbortController().signal);
    await synchronizeSession(state.dependencies, new AbortController().signal);

    expect(state.bootstrapCalls).toBe(1);
    queryClient.clear();
  });

  test("persists and seeds only the server-confirmed Workspace", async () => {
    const queryClient = new QueryClient();
    const state = synchronizer(queryClient, {
      bootstrap: bootstrap(),
      storedWorkspaceId: "workspace-outside-list",
    });

    const session = await synchronizeSession(state.dependencies, new AbortController().signal);

    expect(session).toEqual({
      serverReady: true,
      signedIn: true,
      workspaceId: "workspace-1",
    });
    expect(state.savedWorkspaceIds).toEqual(["workspace-1"]);
    expect(state.clearTokenCalls).toBe(0);
    expect(
      queryClient.getQueryData<AppBootstrap["workspaces"]>(openPostBootstrapQueryKeys.workspaces()),
    ).toEqual(bootstrap().workspaces);
    expect(
      queryClient.getQueryData<AppBootstrap["selected_workspace_settings"]>(
        openPostBootstrapQueryKeys.workspaceSettings("workspace-1"),
      ),
    ).toEqual(bootstrap().selected_workspace_settings);
    queryClient.clear();
  });

  test("clears auth only for an explicit anonymous result", async () => {
    const queryClient = new QueryClient();
    const state = synchronizer(queryClient, {
      bootstrap: {
        authenticated: false,
        selected_workspace_id: null,
        selected_workspace_settings: null,
        user: null,
        workspaces: [],
      },
    });

    const session = await synchronizeSession(state.dependencies, new AbortController().signal);

    expect(state.clearTokenCalls).toBe(1);
    expect(state.clearWorkspaceCalls).toBe(0);
    expect(session).toEqual({ serverReady: true, signedIn: false, workspaceId: null });
    queryClient.clear();
  });

  test("preserves auth for zero Workspaces and SSO-blocked settings", async () => {
    const queryClient = new QueryClient();
    const empty = synchronizer(queryClient, {
      bootstrap: {
        ...bootstrap(),
        selected_workspace_id: null,
        selected_workspace_settings: null,
        workspaces: [],
      },
    });

    const emptySession = await synchronizeSession(empty.dependencies, new AbortController().signal);
    expect(empty.clearWorkspaceCalls).toBe(1);
    expect(empty.clearTokenCalls).toBe(0);
    expect(emptySession.signedIn).toBe(true);
    expect(emptySession.workspaceId).toBeNull();

    const blocked = synchronizer(new QueryClient(), {
      bootstrap: { ...bootstrap(), selected_workspace_settings: null },
    });
    const blockedSession = await synchronizeSession(
      blocked.dependencies,
      new AbortController().signal,
    );
    expect(blocked.clearTokenCalls).toBe(0);
    expect(blockedSession.workspaceId).toBe("workspace-1");
    queryClient.clear();
  });

  test("rejects a selected Workspace that is absent from the server response", async () => {
    const queryClient = new QueryClient();
    const state = synchronizer(queryClient, {
      bootstrap: { ...bootstrap(), selected_workspace_id: "workspace-outside-list" },
    });

    const session = await synchronizeSession(state.dependencies, new AbortController().signal);

    expect(state.savedWorkspaceIds).toEqual([]);
    expect(state.clearWorkspaceCalls).toBe(1);
    expect(state.clearTokenCalls).toBe(0);
    expect(session.workspaceId).toBeNull();
    queryClient.clear();
  });

  test("does not persist or seed a response after the session identity changes", async () => {
    const queryClient = new QueryClient();
    const state = synchronizer(queryClient, { bootstrap: bootstrap() });
    state.dependencies.readAppBootstrap = async () => {
      state.token = "replacement-token";
      return bootstrap();
    };

    await expect(
      synchronizeSession(state.dependencies, new AbortController().signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(state.savedWorkspaceIds).toEqual([]);
    expect(queryClient.getQueryData(openPostBootstrapQueryKeys.workspaces())).toBeUndefined();
    queryClient.clear();
  });

  test("does not clear a newer token when an old bootstrap reports anonymous", async () => {
    storedIdentity.clear();
    storedIdentity.set("openpost.auth.token", "token-old");
    storedIdentity.set("openpost.workspace.id", "workspace-old");
    await loadToken();
    await loadWorkspaceId();
    await setServer("https://anonymous-bootstrap.example.com");
    const bootstrapStarted = deferred<void>();
    const releaseBootstrap = deferred<AppBootstrap>();
    const client = new QueryClient();
    const synchronization = synchronizeSession(
      {
        queryClient: client,
        getServer: () => ({ baseUrl: "https://anonymous-bootstrap.example.com", isHosted: false }),
        getToken,
        getWorkspaceId,
        captureIdentity: captureApiRequestIdentity,
        identityIsCurrent: apiRequestIdentityIsCurrent,
        commitWorkspaceId: commitWorkspaceIdForIdentity,
        clearToken: clearTokenForIdentity,
        readAppBootstrap: async () => {
          bootstrapStarted.resolve();
          return releaseBootstrap.promise;
        },
      },
      new AbortController().signal,
    );
    await bootstrapStarted.promise;
    const tokenWriteStarted = deferred<void>();
    const releaseTokenWrite = deferred<void>();
    pendingTokenWrite = { started: tokenWriteStarted, release: releaseTokenWrite };
    const newerLogin = commitTokenForIdentity("token-new", captureApiRequestIdentity());
    await tokenWriteStarted.promise;
    releaseBootstrap.resolve({
      authenticated: false,
      selected_workspace_id: null,
      selected_workspace_settings: null,
      user: null,
      workspaces: [],
    });
    releaseTokenWrite.resolve();

    expect(await newerLogin).toBe(true);
    await expect(synchronization).rejects.toMatchObject({ name: "AbortError" });
    expect(getToken()).toBe("token-new");
    expect(storedIdentity.get("openpost.auth.token")).toBe("token-new");
    expect(client.getQueryData(openPostBootstrapQueryKeys.workspaces())).toBeUndefined();
    client.clear();
  });

  for (const scenario of [
    { name: "overwrite", operation: "set" as const, selectedWorkspaceId: "workspace-new" },
    { name: "clear", operation: "delete" as const, selectedWorkspaceId: null },
  ]) {
    test(`does not ${scenario.name} the Workspace after its server changes mid-write`, async () => {
      await hydrateStoredIdentity("token-old", "workspace-old");
      await setServer("https://old-bootstrap.example.com");
      const started = deferred<void>();
      const release = deferred<void>();
      pendingWorkspaceWrite = { operation: scenario.operation, started, release };
      const client = new QueryClient();
      const synchronization = synchronizeSession(
        actualSynchronizer(client, bootstrapFor(scenario.selectedWorkspaceId)),
        new AbortController().signal,
      );

      await started.promise;
      await setServer("https://new-bootstrap.example.com");
      release.resolve();

      await expect(synchronization).rejects.toMatchObject({ name: "AbortError" });
      expect(storedIdentity.get("openpost.workspace.id")).toBe("workspace-old");
      expect(getWorkspaceId()).toBe("workspace-old");
      expect(client.getQueryData(openPostBootstrapQueryKeys.workspaces())).toBeUndefined();
      client.clear();
    });
  }

  for (const scenario of [
    { name: "overwrite", operation: "set" as const, selectedWorkspaceId: "workspace-new" },
    { name: "clear", operation: "delete" as const, selectedWorkspaceId: null },
  ]) {
    test(`does not ${scenario.name} the Workspace after a token change queues mid-write`, async () => {
      await hydrateStoredIdentity("token-old", "workspace-old");
      await setServer("https://token-bootstrap.example.com");
      const started = deferred<void>();
      const release = deferred<void>();
      pendingWorkspaceWrite = { operation: scenario.operation, started, release };
      const client = new QueryClient();
      const synchronization = synchronizeSession(
        actualSynchronizer(client, bootstrapFor(scenario.selectedWorkspaceId)),
        new AbortController().signal,
      );

      await started.promise;
      const newerLogin = commitTokenForIdentity("token-new", captureApiRequestIdentity());
      release.resolve();

      await expect(synchronization).rejects.toMatchObject({ name: "AbortError" });
      expect(await newerLogin).toBe(true);
      expect(storedIdentity.has("openpost.workspace.id")).toBe(false);
      expect(getWorkspaceId()).toBeNull();
      expect(client.getQueryData(openPostBootstrapQueryKeys.workspaces())).toBeUndefined();
      client.clear();
    });
  }
});

function synchronizer(
  queryClient: QueryClient,
  {
    bootstrap: result,
    storedWorkspaceId = "workspace-1",
  }: { bootstrap: AppBootstrap; storedWorkspaceId?: string },
) {
  let workspaceId: string | null = storedWorkspaceId;
  const savedWorkspaceIds: string[] = [];
  const state = {
    token: "token-1" as string | null,
    bootstrapCalls: 0,
    clearTokenCalls: 0,
    clearWorkspaceCalls: 0,
    savedWorkspaceIds,
    dependencies: {} as SessionSynchronizer,
  };
  state.dependencies = {
    queryClient,
    getServer: () => ({ baseUrl: "https://app.openpo.st", isHosted: true }),
    getToken: () => state.token,
    getWorkspaceId: () => workspaceId,
    captureIdentity: () => ({
      serverBaseUrl: "https://app.openpo.st",
      serverMutationRevision: 0,
      token: state.token,
      tokenMutationRevision: 0,
      workspaceMutationRevision: 0,
    }),
    identityIsCurrent: (identity) =>
      identity.serverBaseUrl === "https://app.openpo.st" && identity.token === state.token,
    commitWorkspaceId: async (nextWorkspaceId) => {
      if (nextWorkspaceId) savedWorkspaceIds.push(nextWorkspaceId);
      else state.clearWorkspaceCalls += 1;
      workspaceId = nextWorkspaceId;
      return true;
    },
    clearToken: async () => {
      state.clearTokenCalls += 1;
      state.token = null;
      workspaceId = null;
      return true;
    },
    readAppBootstrap: async () => {
      state.bootstrapCalls += 1;
      return result;
    },
  };
  return state;
}

function bootstrap(): AppBootstrap {
  return {
    authenticated: true,
    selected_workspace_id: "workspace-1",
    selected_workspace_settings: {
      avatar_url: "",
      color: "#000000",
      media_cleanup_days: 14,
      name: "Workspace",
      random_delay_minutes: 0,
      slot_end_hour: 17,
      slot_interval_minutes: 60,
      slot_start_hour: 9,
      timezone: "UTC",
      week_start: 1,
    },
    user: null,
    workspaces: [
      {
        avatar_url: "",
        can_edit: true,
        color: "#000000",
        created_at: "2026-09-01T00:00:00Z",
        id: "workspace-1",
        name: "Workspace",
        organization_id: "organization-1",
        organization_name: "Organization",
        role: "admin",
        sso_authenticated: true,
        sso_identity_linked: true,
        sso_required: false,
      },
    ],
  };
}

function bootstrapFor(selectedWorkspaceId: string | null): AppBootstrap {
  if (!selectedWorkspaceId) {
    return {
      ...bootstrap(),
      selected_workspace_id: null,
      selected_workspace_settings: null,
      workspaces: [],
    };
  }
  const result = bootstrap();
  const workspace = { ...result.workspaces[0], id: selectedWorkspaceId };
  return {
    ...result,
    selected_workspace_id: selectedWorkspaceId,
    selected_workspace_settings: { ...result.selected_workspace_settings!, name: workspace.name },
    workspaces: [workspace],
  };
}

function actualSynchronizer(queryClient: QueryClient, result: AppBootstrap): SessionSynchronizer {
  return {
    queryClient,
    getServer,
    getToken,
    getWorkspaceId,
    captureIdentity: captureApiRequestIdentity,
    identityIsCurrent: apiRequestIdentityIsCurrent,
    commitWorkspaceId: commitWorkspaceIdForIdentity,
    clearToken: clearTokenForIdentity,
    readAppBootstrap: async () => result,
  };
}

async function hydrateStoredIdentity(token: string, workspaceId: string): Promise<void> {
  storedIdentity.clear();
  storedIdentity.set("openpost.auth.token", token);
  storedIdentity.set("openpost.workspace.id", workspaceId);
  await loadToken();
  await loadWorkspaceId();
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
