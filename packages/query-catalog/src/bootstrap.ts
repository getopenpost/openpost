import type { components } from "@openpost/api-contract";
import type { QueryClient, QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryKeys, openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, stableQueryStaleTime } from "./policies";

export type AppBootstrap = components["schemas"]["AppBootstrapOutputBody"];
export type AppBootstrapWorkspace = AppBootstrap["workspaces"][number];
export type AppBootstrapWorkspaceSettings = AppBootstrap["selected_workspace_settings"];

export interface AppBootstrapQueryAPI {
  getAppBootstrap(preferredWorkspaceId: string | null, signal: AbortSignal): Promise<AppBootstrap>;
}

type BootstrapCache = Pick<QueryClient, "setQueryData">;

export function normalizePreferredWorkspaceId(workspaceId: string | null | undefined): string {
  return workspaceId?.trim() ?? "";
}

export const openPostBootstrapQueryKeys = {
  app: (preferredWorkspaceId?: string | null) =>
    [
      ...openPostQueryKeys.all,
      "app",
      "bootstrap",
      { preferredWorkspaceId: normalizePreferredWorkspaceId(preferredWorkspaceId) },
    ] as const,
  workspaces: () => [...openPostQueryKeys.all, "workspaces"] as const,
  workspaceSettings: (workspaceId: string) =>
    [...openPostWorkspaceKey(workspaceId), "settings"] as const,
};

export function appBootstrapQueryOptions(
  api: AppBootstrapQueryAPI,
  preferredWorkspaceId?: string | null,
) {
  const normalizedPreferredWorkspaceId = normalizePreferredWorkspaceId(preferredWorkspaceId);
  const queryKey = openPostBootstrapQueryKeys.app(normalizedPreferredWorkspaceId);
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getAppBootstrap(normalizedPreferredWorkspaceId || null, signal),
  };
}

export function confirmedBootstrapWorkspaceId(bootstrap: AppBootstrap): string | null {
  const selectedWorkspaceId = bootstrap.selected_workspace_id;
  if (!selectedWorkspaceId) return null;
  return bootstrap.workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : null;
}

export function seedAppBootstrap(cache: BootstrapCache, bootstrap: AppBootstrap): AppBootstrap {
  cache.setQueryData(openPostBootstrapQueryKeys.workspaces(), bootstrap.workspaces);
  const workspaceId = confirmedBootstrapWorkspaceId(bootstrap);
  if (workspaceId && bootstrap.selected_workspace_settings) {
    cache.setQueryData(
      openPostBootstrapQueryKeys.workspaceSettings(workspaceId),
      bootstrap.selected_workspace_settings,
    );
  }
  return bootstrap;
}
