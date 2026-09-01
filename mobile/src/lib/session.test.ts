import { describe, expect, test } from "bun:test";
import { openPostBootstrapQueryKeys, type AppBootstrap } from "@openpost/query-catalog";
import { QueryClient } from "@tanstack/react-query";

import {
  loadSessionState,
  synchronizeSession,
  type SessionLoaders,
  type SessionSynchronizer,
} from "./session";

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
    saveWorkspaceId: async (nextWorkspaceId) => {
      savedWorkspaceIds.push(nextWorkspaceId);
      workspaceId = nextWorkspaceId;
    },
    clearWorkspaceId: async () => {
      state.clearWorkspaceCalls += 1;
      workspaceId = null;
    },
    clearToken: async () => {
      state.clearTokenCalls += 1;
      state.token = null;
      workspaceId = null;
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
