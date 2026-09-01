import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  appBootstrapQueryOptions,
  confirmedBootstrapWorkspaceId,
  openPostBootstrapQueryKeys,
  seedAppBootstrap,
  type AppBootstrap,
} from "./bootstrap";

describe("application bootstrap queries", () => {
  it("normalizes the preferred Workspace in a stable application key", () => {
    expect(openPostBootstrapQueryKeys.app(" workspace-1 ")).toEqual([
      "openpost",
      "v1",
      "app",
      "bootstrap",
      { preferredWorkspaceId: "workspace-1" },
    ]);
    expect(openPostBootstrapQueryKeys.app()).toEqual([
      "openpost",
      "v1",
      "app",
      "bootstrap",
      { preferredWorkspaceId: "" },
    ]);
  });

  it("forwards cancellation and keeps bootstrap state fresh for five minutes", async () => {
    const bootstrap = authenticatedBootstrap();
    const getAppBootstrap = vi.fn(async () => bootstrap);
    const client = new QueryClient();
    const options = appBootstrapQueryOptions({ getAppBootstrap }, " workspace-1 ");

    await expect(client.fetchQuery(options)).resolves.toBe(bootstrap);
    expect(options.staleTime).toBe(300_000);
    expect(getAppBootstrap).toHaveBeenCalledWith("workspace-1", expect.any(AbortSignal));
    client.clear();
  });

  it("accepts and seeds only a selected Workspace returned in the server list", () => {
    const client = new QueryClient();
    const bootstrap = authenticatedBootstrap();

    seedAppBootstrap(client, bootstrap);

    expect(confirmedBootstrapWorkspaceId(bootstrap)).toBe("workspace-1");
    expect(client.getQueryData(openPostBootstrapQueryKeys.workspaces())).toEqual(
      bootstrap.workspaces,
    );
    expect(
      client.getQueryData(openPostBootstrapQueryKeys.workspaceSettings("workspace-1")),
    ).toEqual(bootstrap.selected_workspace_settings);

    expect(
      confirmedBootstrapWorkspaceId({
        ...bootstrap,
        selected_workspace_id: "workspace-outside-list",
      }),
    ).toBeNull();
    client.clear();
  });
});

function authenticatedBootstrap(): AppBootstrap {
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
