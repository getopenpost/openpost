import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { capabilityStaleTime, openPostQueryPolicy, queryStaleTime } from "./policies";
import type { QueryCachePlan } from "./cache-plan";

export type ThemeSummary = components["schemas"]["ThemeSummary"];
export type ThemeSummaryPage = components["schemas"]["ThemeSummaryPage"];
export type OrganizationTheme = components["schemas"]["Theme"];
export type PublishedThemeCatalogItem = components["schemas"]["PublishedThemeCatalogItem"];
export type ThemeManifest = components["schemas"]["ThemeManifest"];
export type ResolvedTheme = components["schemas"]["ResolvedTheme"];
export type ThemeSettings = components["schemas"]["ThemeSettings"];
export type OrganizationThemeSettings = components["schemas"]["OrganizationThemeSettings"];
export type PublishedRevision = components["schemas"]["PublishedRevision"];
export type PublishedRevisionPage = components["schemas"]["PublishedRevisionPage"];
export type ThemeAssetRecord = components["schemas"]["ThemeAssetRecord"];
export type ThemeAssetPage = components["schemas"]["ThemeAssetPage"];
export type CreateThemeInput = components["schemas"]["CreateThemeInputBody"];
export type UpdateThemeDraftInput = components["schemas"]["UpdateThemeDraftInputBody"];
export type PublishThemeInput = components["schemas"]["PublishThemeInputBody"];
export type RollbackThemeInput = components["schemas"]["RollbackThemeInputBody"];
export type UpdateOrganizationThemeSettingsInput =
  components["schemas"]["UpdateOrganizationThemeSettingsInputBody"];
export type UpdateWorkspaceThemeAssignmentInput =
  components["schemas"]["UpdateWorkspaceThemeAssignmentInputBody"];

export interface ThemeQueryAPI {
  listBuiltInThemes(signal: AbortSignal): Promise<ThemeManifest[]>;
  listOrganizationThemes(
    workspaceId: string,
    organizationId: string,
    cursor: string,
    signal: AbortSignal,
  ): Promise<ThemeSummaryPage>;
  getOrganizationTheme(
    workspaceId: string,
    organizationId: string,
    themeId: string,
    signal: AbortSignal,
  ): Promise<OrganizationTheme>;
  listAvailableThemes(workspaceId: string, signal: AbortSignal): Promise<ThemeSummaryPage>;
  getAvailableCustomTheme(
    workspaceId: string,
    themeId: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<PublishedThemeCatalogItem>;
  resolveTheme(workspaceId: string, scheme: string, signal: AbortSignal): Promise<ResolvedTheme>;
  getThemeSettings(workspaceId: string, signal: AbortSignal): Promise<ThemeSettings>;
  listThemeRevisions(
    workspaceId: string,
    organizationId: string,
    themeId: string,
    cursor: string,
    signal: AbortSignal,
  ): Promise<PublishedRevisionPage>;
  getThemeRevision(
    workspaceId: string,
    themeId: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<PublishedRevision>;
  listThemeAssets(
    workspaceId: string,
    organizationId: string,
    cursor: string,
    signal: AbortSignal,
  ): Promise<ThemeAssetPage>;
}

export const themeQueryKeys = {
  builtIns: () => ["openpost", "v1", "themes", "built-ins"] as const,
  lists: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "themes", "list"),
  list: (workspaceId: string, cursor = "") =>
    openPostWorkspaceKey(workspaceId, "themes", "list", { cursor }),
  detail: (workspaceId: string, themeId: string) =>
    openPostWorkspaceKey(workspaceId, "themes", "detail", themeId),
  available: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "themes", "available"),
  availableDetail: (workspaceId: string, themeId: string, revision?: number) =>
    openPostWorkspaceKey(workspaceId, "themes", "available", themeId, { revision: revision ?? 0 }),
  resolved: (workspaceId: string, scheme: string) =>
    openPostWorkspaceKey(workspaceId, "themes", "resolved", { scheme }),
  settings: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "themes", "settings"),
  revisions: (workspaceId: string, themeId: string, cursor = "") =>
    openPostWorkspaceKey(workspaceId, "themes", "detail", themeId, "revisions", { cursor }),
  revision: (workspaceId: string, themeId: string, revision: number) =>
    openPostWorkspaceKey(workspaceId, "themes", "detail", themeId, "revisions", revision),
  assets: (workspaceId: string, cursor = "") =>
    openPostWorkspaceKey(workspaceId, "themes", "assets", { cursor }),
};

export function builtInThemesQueryOptions(api: Pick<ThemeQueryAPI, "listBuiltInThemes">) {
  const queryKey = themeQueryKeys.builtIns();
  return {
    ...openPostQueryPolicy(capabilityStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listBuiltInThemes(signal),
  };
}

export function organizationThemesQueryOptions(
  api: Pick<ThemeQueryAPI, "listOrganizationThemes">,
  workspaceId: string,
  organizationId: string,
  cursor = "",
) {
  const queryKey = themeQueryKeys.list(workspaceId, cursor);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId) && Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listOrganizationThemes(workspaceId, organizationId, cursor, signal),
  };
}

export function organizationThemeQueryOptions(
  api: Pick<ThemeQueryAPI, "getOrganizationTheme">,
  workspaceId: string,
  organizationId: string,
  themeId: string,
) {
  const queryKey = themeQueryKeys.detail(workspaceId, themeId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId) && Boolean(organizationId) && Boolean(themeId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getOrganizationTheme(workspaceId, organizationId, themeId, signal),
  };
}

export function availableThemesQueryOptions(
  api: Pick<ThemeQueryAPI, "listAvailableThemes">,
  workspaceId: string,
) {
  const queryKey = themeQueryKeys.available(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listAvailableThemes(workspaceId, signal),
  };
}

export function availableThemeQueryOptions(
  api: Pick<ThemeQueryAPI, "getAvailableCustomTheme">,
  workspaceId: string,
  themeId: string,
  revision: number,
) {
  const queryKey = themeQueryKeys.availableDetail(workspaceId, themeId, revision);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId) && Boolean(themeId) && Number.isFinite(revision),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getAvailableCustomTheme(workspaceId, themeId, revision, signal),
  };
}

export function resolvedThemeQueryOptions(
  api: Pick<ThemeQueryAPI, "resolveTheme">,
  workspaceId: string,
  scheme: string,
) {
  const normalizedScheme = scheme.trim() || "system";
  const queryKey = themeQueryKeys.resolved(workspaceId, normalizedScheme);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.resolveTheme(workspaceId, normalizedScheme, signal),
  };
}

export function themeSettingsQueryOptions(
  api: Pick<ThemeQueryAPI, "getThemeSettings">,
  workspaceId: string,
) {
  const queryKey = themeQueryKeys.settings(workspaceId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getThemeSettings(workspaceId, signal),
  };
}

export function themeRevisionsQueryOptions(
  api: Pick<ThemeQueryAPI, "listThemeRevisions">,
  workspaceId: string,
  organizationId: string,
  themeId: string,
  cursor = "",
) {
  const queryKey = themeQueryKeys.revisions(workspaceId, themeId, cursor);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId) && Boolean(organizationId) && Boolean(themeId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listThemeRevisions(workspaceId, organizationId, themeId, cursor, signal),
  };
}

export function themeAssetsQueryOptions(
  api: Pick<ThemeQueryAPI, "listThemeAssets">,
  workspaceId: string,
  organizationId: string,
  cursor = "",
) {
  const queryKey = themeQueryKeys.assets(workspaceId, cursor);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId) && Boolean(organizationId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listThemeAssets(workspaceId, organizationId, cursor, signal),
  };
}

/**
 * Every theme write can change the workspace-visible resolution, the library
 * lists, the edited detail, and the assignment settings, so one shared plan
 * keeps publishes, rollbacks, assignments, and deletes consistent.
 */
export function themeMutationCachePlan(workspaceId: string, themeId?: string): QueryCachePlan {
  return {
    invalidate: [
      { queryKey: themeQueryKeys.lists(workspaceId) },
      { queryKey: themeQueryKeys.available(workspaceId) },
      { queryKey: themeQueryKeys.settings(workspaceId) },
      ...(themeId
        ? [
            { queryKey: themeQueryKeys.detail(workspaceId, themeId) },
            { queryKey: themeQueryKeys.revisions(workspaceId, themeId) },
          ]
        : []),
    ],
  };
}
