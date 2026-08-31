import { describe, expect, test } from "bun:test";

import { destinationState, workspaceEmptyState } from "./first-use";

describe("first-use recovery", () => {
  test("gives a user without workspaces web, retry, and sign-in actions", () => {
    const state = workspaceEmptyState("https://app.openpost.social");

    expect(state.actions).toEqual([
      {
        kind: "open-url",
        label: "Open web app",
        url: "https://app.openpost.social",
      },
      { kind: "retry", label: "Retry" },
      {
        kind: "navigate",
        label: "Back to sign in",
        route: "/onboarding/login",
      },
    ]);
  });

  test("stops before Drafts until an active destination exists", () => {
    expect(destinationState(null)).toEqual({
      kind: "checking",
      route: "/onboarding/destination",
    });

    const setup = destinationState([{ is_active: false }], "https://openpost.example.com");

    expect(setup).toEqual({
      kind: "setup",
      title: "Connect a destination",
      body: "Connect a social account in the web app, then return here.",
      actions: [
        {
          kind: "open-url",
          label: "Open account settings",
          url: "https://openpost.example.com/settings?tab=accounts",
        },
        { kind: "retry", label: "Retry" },
        {
          kind: "navigate",
          label: "Back to workspaces",
          route: "/onboarding/workspace",
        },
      ],
    });

    expect(destinationState([{ is_active: true }], "https://openpost.example.com")).toEqual({
      kind: "ready",
      route: "/(tabs)/drafts",
    });
  });
});
