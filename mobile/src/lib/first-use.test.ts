import { describe, expect, test } from "bun:test";

import { destinationState, workspaceEmptyState } from "./first-use";

describe("first-use recovery", () => {
  test("routes onboarding around missing workspaces and destinations", () => {
    // No workspaces: offer a way out instead of landing on an empty app.
    expect(workspaceEmptyState("https://app.openpo.st").actions.length).toBeGreaterThan(0);

    // Destinations still loading: wait before choosing a landing route.
    expect(destinationState(null).route).toBe("/onboarding/destination");

    // No active destination: stay in setup instead of entering Drafts.
    expect(destinationState([{ is_active: false }], "https://openpost.example.com").kind).toBe(
      "setup",
    );

    // Active destination: enter the app.
    const ready = destinationState([{ is_active: true }], "https://openpost.example.com");
    expect(ready.kind).toBe("ready");
    if (ready.kind === "ready") expect(ready.route).toBe("/(tabs)/drafts");
  });
});
