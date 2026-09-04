import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { resolvedThemeQueryOptions, themeMutationCachePlan, themeQueryKeys } from "./index";

describe("theme queries", () => {
  it("rejects unknown schemes instead of producing a key the backend refuses", () => {
    // resolveTheme is never reached: the guard throws during options construction.
    const api = { resolveTheme: vi.fn() };
    // SAFETY: passes a scheme the type system forbids to exercise the runtime guard.
    expect(() => resolvedThemeQueryOptions(api, "workspace-a", "system" as "dark")).toThrow(
      /unknown scheme/,
    );
  });
  it("keeps library, detail, resolution, and settings coherent after writes", () => {
    const scoped = themeMutationCachePlan("workspace-a", "theme-1").invalidate.map(
      (filters) => filters.queryKey,
    );
    expect(scoped).toContainEqual(themeQueryKeys.lists("workspace-a"));
    expect(scoped).toContainEqual(themeQueryKeys.available("workspace-a"));
    expect(scoped).toContainEqual(themeQueryKeys.settings("workspace-a"));
    expect(scoped).toContainEqual(themeQueryKeys.resolvedScope("workspace-a"));
    expect(scoped).toContainEqual(themeQueryKeys.detail("workspace-a", "theme-1"));

    const unscoped = themeMutationCachePlan("workspace-a").invalidate.map(
      (filters) => filters.queryKey,
    );
    expect(unscoped).toContainEqual(themeQueryKeys.lists("workspace-a"));
    expect(unscoped).toContainEqual(themeQueryKeys.resolvedScope("workspace-a"));
    expect(unscoped).not.toContainEqual(themeQueryKeys.detail("workspace-a", "theme-1"));
  });

  it("invalidates every resolved scheme after writes", () => {
    const scope = themeQueryKeys.resolvedScope("workspace-a");
    for (const scheme of ["light", "dark"]) {
      const resolved = themeQueryKeys.resolved("workspace-a", scheme);
      expect(resolved.slice(0, scope.length)).toEqual([...scope]);
    }
  });
});
