import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostBootstrapQueryKeys } from "./bootstrap";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type WorkspaceTeam = components["schemas"]["WorkspaceTeamOutputBody"];
export type WorkspaceAccessAudit = components["schemas"]["WorkspaceAccessAuditResponse"];
export type WorkspaceSetup = components["schemas"]["WorkspaceSetupResponse"];
export type WorkspaceSettings = components["schemas"]["GetWorkspaceSettingsOutputBody"];

export interface WorkspaceSettingsQueryAPI {
  getWorkspaceTeam(workspaceId: string, signal: AbortSignal): Promise<WorkspaceTeam>;
  listWorkspaceAccessAudit(
    workspaceId: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<WorkspaceAccessAudit[]>;
  getWorkspaceSetup(workspaceId: string, signal: AbortSignal): Promise<WorkspaceSetup>;
  getWorkspaceSettings(workspaceId: string, signal: AbortSignal): Promise<WorkspaceSettings>;
}

export const workspaceSettingsQueryKeys = {
  team: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "team"),
  accessAudit: (workspaceId: string, limit: number) =>
    openPostWorkspaceKey(workspaceId, "access-audit", { limit }),
  setup: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "setup"),
  settings: openPostBootstrapQueryKeys.workspaceSettings,
};

export function isWorkspaceSetupQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === "openpost" &&
    queryKey[1] === "v1" &&
    queryKey[2] === "workspace" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "setup"
  );
}

export function workspaceTeamQueryOptions(
  api: Pick<WorkspaceSettingsQueryAPI, "getWorkspaceTeam">,
  workspaceId: string,
) {
  const queryKey = workspaceSettingsQueryKeys.team(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getWorkspaceTeam(workspaceId, signal),
  };
}

export function workspaceAccessAuditQueryOptions(
  api: Pick<WorkspaceSettingsQueryAPI, "listWorkspaceAccessAudit">,
  workspaceId: string,
  limit: number,
) {
  const normalizedLimit = Math.max(1, Math.trunc(limit));
  const queryKey = workspaceSettingsQueryKeys.accessAudit(workspaceId, normalizedLimit);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listWorkspaceAccessAudit(workspaceId, normalizedLimit, signal),
  };
}

export function workspaceSetupQueryOptions(
  api: Pick<WorkspaceSettingsQueryAPI, "getWorkspaceSetup">,
  workspaceId: string,
) {
  const queryKey = workspaceSettingsQueryKeys.setup(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getWorkspaceSetup(workspaceId, signal),
  };
}

export function workspaceSettingsQueryOptions(
  api: Pick<WorkspaceSettingsQueryAPI, "getWorkspaceSettings">,
  workspaceId: string,
) {
  const queryKey = workspaceSettingsQueryKeys.settings(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getWorkspaceSettings(workspaceId, signal),
  };
}
