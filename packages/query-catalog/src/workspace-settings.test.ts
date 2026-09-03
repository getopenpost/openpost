import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  isWorkspaceSetupQueryKey,
  workspaceAccessAuditQueryOptions,
  workspaceSettingsQueryKeys,
  workspaceSettingsQueryOptions,
  workspaceSetupQueryOptions,
  workspaceTeamQueryOptions,
  type WorkspaceAccessAudit,
  type WorkspaceSettings,
  type WorkspaceSetup,
  type WorkspaceTeam,
} from "./index";

describe("Workspace settings queries", () => {
  it("uses canonical Workspace keys and forwards cancellation", async () => {
    const team = { members: [] } as unknown as WorkspaceTeam;
    const audit = [] as WorkspaceAccessAudit[];
    const setup = { visible: false } as unknown as WorkspaceSetup;
    const settings = { timezone: "UTC" } as WorkspaceSettings;
    const api = {
      getWorkspaceTeam: vi.fn(async () => team),
      listWorkspaceAccessAudit: vi.fn(async () => audit),
      getWorkspaceSetup: vi.fn(async () => setup),
      getWorkspaceSettings: vi.fn(async () => settings),
    };
    const client = new QueryClient();

    await client.fetchQuery(workspaceTeamQueryOptions(api, "workspace-1"));
    await client.fetchQuery(workspaceAccessAuditQueryOptions(api, "workspace-1", 20.8));
    await client.fetchQuery(workspaceSetupQueryOptions(api, "workspace-1"));
    await client.fetchQuery(workspaceSettingsQueryOptions(api, "workspace-1"));

    expect(workspaceSettingsQueryKeys.team("workspace-1")).toEqual([
      "openpost",
      "v1",
      "workspace",
      "workspace-1",
      "team",
    ]);
    expect(api.listWorkspaceAccessAudit).toHaveBeenCalledWith(
      "workspace-1",
      20,
      expect.any(AbortSignal),
    );
    expect(api.getWorkspaceSettings).toHaveBeenCalledWith("workspace-1", expect.any(AbortSignal));
    expect(isWorkspaceSetupQueryKey(workspaceSettingsQueryKeys.setup("workspace-1"))).toBe(true);
    expect(isWorkspaceSetupQueryKey(workspaceSettingsQueryKeys.team("workspace-1"))).toBe(false);
  });
});
