import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  availableThemeQueryOptions,
  availableThemesQueryOptions,
  builtInThemesQueryOptions,
  organizationThemeQueryOptions,
  organizationThemesQueryOptions,
  resolvedThemeQueryOptions,
  themeAssetsQueryOptions,
  themeMutationCachePlan,
  themeQueryKeys,
  themeRevisionsQueryOptions,
  themeSettingsQueryOptions,
  type OrganizationTheme,
  type PublishedRevisionPage,
  type PublishedThemeCatalogItem,
  type ResolvedTheme,
  type ThemeAssetPage,
  type ThemeSettings,
  type ThemeSummaryPage,
} from "./index";

describe("theme queries", () => {
  it("partitions theme reads by workspace and pins immutable revisions", () => {
    expect(themeQueryKeys.list("workspace-a")).not.toEqual(themeQueryKeys.list("workspace-b"));
    expect(themeQueryKeys.resolved("workspace-a", "light")).not.toEqual(
      themeQueryKeys.resolved("workspace-b", "light"),
    );
    expect(themeQueryKeys.resolved("workspace-a", "light")).not.toEqual(
      themeQueryKeys.resolved("workspace-a", "dark"),
    );
    // One immutable published revision never shares a cache entry with another.
    expect(themeQueryKeys.availableDetail("workspace-a", "theme-1", 2)).not.toEqual(
      themeQueryKeys.availableDetail("workspace-a", "theme-1", 3),
    );
    expect(themeQueryKeys.availableDetail("workspace-a", "theme-1", 2)).toEqual(
      themeQueryKeys.availableDetail("workspace-a", "theme-1", 2),
    );
  });

  it("forwards workspace, revision, and cancellation to every theme read", async () => {
    const page = { items: [], next_cursor: null } as unknown as ThemeSummaryPage;
    const assetPage = { items: [], next_cursor: null } as unknown as ThemeAssetPage;
    const revisionPage = { items: [] } as unknown as PublishedRevisionPage;
    const settings = { workspace_id: "workspace-a" } as ThemeSettings;
    const theme = { summary: {} } as unknown as OrganizationTheme;
    const catalogItem = { summary: {}, manifest: {} } as unknown as PublishedThemeCatalogItem;
    const resolved = { id: "workshop" } as unknown as ResolvedTheme;
    const api = {
      listBuiltInThemes: vi.fn(async (_signal: AbortSignal) => []),
      listOrganizationThemes: vi.fn(
        async (
          _workspaceId: string,
          _organizationId: string,
          _cursor: string,
          _signal: AbortSignal,
        ) => page,
      ),
      getOrganizationTheme: vi.fn(
        async (
          _workspaceId: string,
          _organizationId: string,
          _themeId: string,
          _signal: AbortSignal,
        ) => theme,
      ),
      listAvailableThemes: vi.fn(async (_workspaceId: string, _signal: AbortSignal) => page),
      getAvailableCustomTheme: vi.fn(
        async (_workspaceId: string, _themeId: string, _revision: number, _signal: AbortSignal) =>
          catalogItem,
      ),
      resolveTheme: vi.fn(
        async (_workspaceId: string, _scheme: string, _signal: AbortSignal) => resolved,
      ),
      getThemeSettings: vi.fn(async (_workspaceId: string, _signal: AbortSignal) => settings),
      listThemeRevisions: vi.fn(
        async (
          _workspaceId: string,
          _organizationId: string,
          _themeId: string,
          _cursor: string,
          _signal: AbortSignal,
        ) => revisionPage,
      ),
      listThemeAssets: vi.fn(
        async (
          _workspaceId: string,
          _organizationId: string,
          _cursor: string,
          _signal: AbortSignal,
        ) => assetPage,
      ),
    };
    const client = new QueryClient();

    await client.fetchQuery(builtInThemesQueryOptions(api));
    await client.fetchQuery(organizationThemesQueryOptions(api, "workspace-a", "org-1"));
    await client.fetchQuery(organizationThemeQueryOptions(api, "workspace-a", "org-1", "theme-1"));
    await client.fetchQuery(availableThemesQueryOptions(api, "workspace-a"));
    await client.fetchQuery(availableThemeQueryOptions(api, "workspace-a", "theme-1", 2));
    await client.fetchQuery(resolvedThemeQueryOptions(api, "workspace-a", "dark"));
    await client.fetchQuery(themeSettingsQueryOptions(api, "workspace-a"));
    await client.fetchQuery(themeRevisionsQueryOptions(api, "workspace-a", "org-1", "theme-1"));
    await client.fetchQuery(themeAssetsQueryOptions(api, "workspace-a", "org-1"));

    expect(api.listBuiltInThemes).toHaveBeenCalledOnce();
    expect(api.listOrganizationThemes).toHaveBeenCalledWith(
      "workspace-a",
      "org-1",
      "",
      expect.anything(),
    );
    expect(api.getOrganizationTheme).toHaveBeenCalledWith(
      "workspace-a",
      "org-1",
      "theme-1",
      expect.anything(),
    );
    // The immutable published revision travels with the catalog detail read.
    expect(api.getAvailableCustomTheme).toHaveBeenCalledWith(
      "workspace-a",
      "theme-1",
      2,
      expect.anything(),
    );
    expect(api.resolveTheme).toHaveBeenCalledWith("workspace-a", "dark", expect.anything());
    // Unknown schemes fail fast instead of producing a key the backend rejects.
    // SAFETY: passes a scheme the type system forbids to exercise the runtime guard.
    expect(() => resolvedThemeQueryOptions(api, "workspace-a", "system" as "dark")).toThrow(
      /unknown scheme/,
    );
    // Asset reads stay organization-scoped so unrelated workspaces never share them.
    expect(api.listThemeAssets).toHaveBeenCalledWith("workspace-a", "org-1", "", expect.anything());
    for (const fn of Object.values(api)) {
      const signal = fn.mock.calls[0]?.[fn.mock.calls[0].length - 1];
      expect(signal).toBeInstanceOf(AbortSignal);
    }
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
