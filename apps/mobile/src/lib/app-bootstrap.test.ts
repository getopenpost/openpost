import { describe, expect, test } from "bun:test";
import type { AppBootstrap } from "@openpost/query-catalog";

import { createAppBootstrapReader, type AppBootstrapTransport } from "./app-bootstrap-reader";
import { OpenPostQueryError } from "./query-policy";

describe("mobile application bootstrap", () => {
  test("uses one request when the server supports application bootstrap", async () => {
    const calls: string[] = [];
    const expected = bootstrap();
    const reader = createAppBootstrapReader(() =>
      transport({
        getBootstrap: async () => {
          calls.push("bootstrap");
          return { data: expected };
        },
      }),
    );

    await expect(
      reader("https://app.openpo.st", "workspace-1", new AbortController().signal),
    ).resolves.toBe(expected);
    expect(calls).toEqual(["bootstrap"]);
  });

  for (const fallbackStatus of [404, 405]) {
    test(`falls back on ${fallbackStatus} and remembers that server for the process`, async () => {
      const calls: string[] = [];
      const signals: AbortSignal[] = [];
      const capabilities = new Map();
      const requestTransport = transport({
        getBootstrap: async (_preferred, signal) => {
          calls.push("bootstrap");
          signals.push(signal);
          return {
            error: { detail: "missing" },
            response: new Response(null, { status: fallbackStatus }),
          };
        },
        getCurrentUser: async (signal) => {
          calls.push("me");
          signals.push(signal);
          return { data: bootstrap().user };
        },
        listWorkspaces: async (signal) => {
          calls.push("workspaces");
          signals.push(signal);
          return { data: bootstrap().workspaces };
        },
        getWorkspaceSettings: async (_workspaceId, signal) => {
          calls.push("settings");
          signals.push(signal);
          return { data: bootstrap().selected_workspace_settings };
        },
      });
      const reader = createAppBootstrapReader(() => requestTransport, capabilities);
      const firstSignal = new AbortController().signal;

      const first = await reader("https://legacy.example.com", "workspace-1", firstSignal);
      expect(first.authenticated).toBe(true);
      expect(first.selected_workspace_id).toBe("workspace-1");
      expect(calls).toEqual(["bootstrap", "me", "workspaces", "settings"]);
      expect(signals.every((signal) => signal === firstSignal)).toBe(true);

      calls.length = 0;
      signals.length = 0;
      await reader("https://legacy.example.com", "workspace-1", new AbortController().signal);
      expect(calls).toEqual(["me", "workspaces", "settings"]);
      expect(capabilities.get("https://legacy.example.com")).toBe("legacy");

      calls.length = 0;
      await reader("https://another-legacy.example.com", "workspace-1", firstSignal);
      expect(calls).toEqual(["bootstrap", "me", "workspaces", "settings"]);
    });
  }

  for (const status of [401, 403, 408, 429, 500]) {
    test(`does not fall back when application bootstrap returns ${status}`, async () => {
      const calls: string[] = [];
      const reader = createAppBootstrapReader(() =>
        transport({
          getBootstrap: async () => {
            calls.push("bootstrap");
            return {
              error: { detail: "bootstrap failed" },
              response: new Response(null, { status }),
            };
          },
          getCurrentUser: async () => {
            calls.push("me");
            return { data: bootstrap().user };
          },
        }),
      );

      const error = await reader(
        `https://status-${status}.example.com`,
        null,
        new AbortController().signal,
      ).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(OpenPostQueryError);
      expect((error as OpenPostQueryError).status).toBe(status);
      expect(calls).toEqual(["bootstrap"]);
    });
  }

  test("does not fall back after a network failure", async () => {
    const calls: string[] = [];
    const reader = createAppBootstrapReader(() =>
      transport({
        getBootstrap: async () => {
          calls.push("bootstrap");
          throw new TypeError("Network request failed");
        },
        getCurrentUser: async () => {
          calls.push("me");
          return { data: bootstrap().user };
        },
      }),
    );

    await expect(
      reader("https://offline.example.com", null, new AbortController().signal),
    ).rejects.toThrow("Network request failed");
    expect(calls).toEqual(["bootstrap"]);
  });

  test("preserves an authenticated legacy session with no Workspace or blocked settings", async () => {
    const noWorkspaceReader = createAppBootstrapReader(() =>
      transport({
        getBootstrap: async () => ({ response: new Response(null, { status: 404 }) }),
        getCurrentUser: async () => ({ data: bootstrap().user }),
        listWorkspaces: async () => ({ data: [] }),
        getWorkspaceSettings: async () => {
          throw new Error("settings must not be requested without a Workspace");
        },
      }),
    );
    const empty = await noWorkspaceReader(
      "https://empty.example.com",
      null,
      new AbortController().signal,
    );
    expect(empty).toMatchObject({
      authenticated: true,
      selected_workspace_id: null,
      selected_workspace_settings: null,
      workspaces: [],
    });

    const blockedReader = createAppBootstrapReader(() =>
      transport({
        getBootstrap: async () => ({ response: new Response(null, { status: 404 }) }),
        getCurrentUser: async () => ({ data: bootstrap().user }),
        listWorkspaces: async () => ({ data: bootstrap().workspaces }),
        getWorkspaceSettings: async () => ({
          error: { detail: "SSO required" },
          response: new Response(null, { status: 403 }),
        }),
      }),
    );
    const blocked = await blockedReader(
      "https://sso.example.com",
      "workspace-1",
      new AbortController().signal,
    );
    expect(blocked.authenticated).toBe(true);
    expect(blocked.selected_workspace_id).toBe("workspace-1");
    expect(blocked.selected_workspace_settings).toBeNull();
  });
});

function transport(overrides: Partial<AppBootstrapTransport>): AppBootstrapTransport {
  return {
    getBootstrap: async () => ({ data: bootstrap() }),
    getCurrentUser: async () => ({ data: bootstrap().user }),
    listWorkspaces: async () => ({ data: bootstrap().workspaces }),
    getWorkspaceSettings: async () => ({ data: bootstrap().selected_workspace_settings }),
    ...overrides,
  };
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
    user: {
      avatar_url: "",
      composer_experience: "unified",
      created_at: "2026-09-01T00:00:00Z",
      display_name: "User",
      email: "user@example.com",
      email_verified: true,
      has_password: true,
      id: "user-1",
      is_admin: false,
      is_managed: false,
      legal_acceptance_required: false,
      password_usable: true,
      public_profile_enabled: false,
      public_profile_visible_fields: null,
      username: "user",
    },
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
