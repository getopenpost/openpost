import { throwIfAborted } from "@openpost/query-catalog";
import { createOpenPostQueryError, type AppBootstrap } from "@openpost/query-catalog";

type BootstrapUser = NonNullable<AppBootstrap["user"]>;
type BootstrapWorkspace = AppBootstrap["workspaces"][number];
type BootstrapWorkspaceSettings = NonNullable<AppBootstrap["selected_workspace_settings"]>;

type RequestResult<T> = {
  data?: T | null;
  error?: unknown;
  response?: Response;
};

export interface AppBootstrapTransport {
  getBootstrap(
    preferredWorkspaceId: string | null,
    signal: AbortSignal,
  ): Promise<RequestResult<AppBootstrap>>;
  getCurrentUser(signal: AbortSignal): Promise<RequestResult<BootstrapUser>>;
  listWorkspaces(signal: AbortSignal): Promise<RequestResult<BootstrapWorkspace[]>>;
  getWorkspaceSettings(
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<RequestResult<BootstrapWorkspaceSettings>>;
}

export type AppBootstrapCapability = "supported" | "legacy";
export type AppBootstrapCapabilityMemory = Map<string, AppBootstrapCapability>;

export function createAppBootstrapReader(
  getTransport: () => AppBootstrapTransport,
  capabilities: AppBootstrapCapabilityMemory = new Map(),
) {
  return async function readAppBootstrap(
    serverBaseUrl: string,
    preferredWorkspaceId: string | null,
    signal: AbortSignal,
  ): Promise<AppBootstrap> {
    const transport = getTransport();
    if (capabilities.get(serverBaseUrl) === "legacy") {
      return readLegacyBootstrap(transport, preferredWorkspaceId, signal);
    }

    const result = await transport.getBootstrap(preferredWorkspaceId, signal);
    throwIfAborted(signal);
    if (result.data) {
      capabilities.set(serverBaseUrl, "supported");
      return result.data;
    }

    const status = result.response?.status;
    if (status !== 404 && status !== 405) {
      throw createOpenPostQueryError(status, result.error, "Could not start OpenPost");
    }

    capabilities.set(serverBaseUrl, "legacy");
    return readLegacyBootstrap(transport, preferredWorkspaceId, signal);
  };
}

async function readLegacyBootstrap(
  transport: AppBootstrapTransport,
  preferredWorkspaceId: string | null,
  signal: AbortSignal,
): Promise<AppBootstrap> {
  const currentUser = await transport.getCurrentUser(signal);
  throwIfAborted(signal);
  if (!currentUser.data) {
    if (currentUser.response?.status === 401) return anonymousBootstrap();
    throw createOpenPostQueryError(
      currentUser.response?.status,
      currentUser.error,
      "Could not verify this session",
    );
  }

  const workspaceResult = await transport.listWorkspaces(signal);
  throwIfAborted(signal);
  if (!workspaceResult.data) {
    if (workspaceResult.response?.status === 401) return anonymousBootstrap();
    throw createOpenPostQueryError(
      workspaceResult.response?.status,
      workspaceResult.error,
      "Could not load workspaces",
    );
  }

  const workspaces = workspaceResult.data.filter(Boolean);
  const preferred = preferredWorkspaceId
    ? workspaces.find((workspace) => workspace.id === preferredWorkspaceId)
    : null;
  const selectedWorkspaceId = preferred?.id ?? workspaces[0]?.id ?? null;
  let selectedWorkspaceSettings: AppBootstrap["selected_workspace_settings"] = null;

  if (selectedWorkspaceId) {
    const settings = await transport.getWorkspaceSettings(selectedWorkspaceId, signal);
    throwIfAborted(signal);
    if (settings.data) {
      selectedWorkspaceSettings = settings.data;
    } else if (settings.response?.status === 401) {
      return anonymousBootstrap();
    } else if (settings.response?.status !== 403) {
      throw createOpenPostQueryError(
        settings.response?.status,
        settings.error,
        "Could not load workspace settings",
      );
    }
  }

  return {
    authenticated: true,
    user: currentUser.data,
    workspaces,
    selected_workspace_id: selectedWorkspaceId,
    selected_workspace_settings: selectedWorkspaceSettings,
  };
}

function anonymousBootstrap(): AppBootstrap {
  return {
    authenticated: false,
    user: null,
    workspaces: [],
    selected_workspace_id: null,
    selected_workspace_settings: null,
  };
}
