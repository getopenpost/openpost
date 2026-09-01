import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type AnalyticsOverview = components["schemas"]["Overview"];
export type AnalyticsRangeDays = 7 | 30 | 90;
export type AnalyticsSource = "all" | "openpost" | "external";
export type AnalyticsSort = "engagement" | "views" | "newest";

export interface AnalyticsFilters {
  readonly days: AnalyticsRangeDays;
  readonly accountId?: string;
  readonly source?: AnalyticsSource;
  readonly sort?: AnalyticsSort;
  readonly limit?: number;
}

export interface AnalyticsQueryAPI {
  getAnalyticsOverview(
    workspaceId: string,
    filters: NormalizedAnalyticsFilters,
    cursor: string,
    signal: AbortSignal,
  ): Promise<AnalyticsOverview>;
}

export const analyticsQueryKeys = {
  all: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "analytics"),
  overview: (workspaceId: string, filters: AnalyticsFilters) =>
    openPostWorkspaceKey(workspaceId, "analytics", "overview", normalizeAnalyticsFilters(filters)),
};

export function analyticsOverviewQueryOptions(
  api: Pick<AnalyticsQueryAPI, "getAnalyticsOverview">,
  workspaceId: string,
  filters: AnalyticsFilters,
) {
  const normalized = normalizeAnalyticsFilters(filters);
  const queryKey = analyticsQueryKeys.overview(workspaceId, normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.getAnalyticsOverview(workspaceId, normalized, pageParam, signal),
    getNextPageParam: (lastPage: AnalyticsOverview) => lastPage.content_next_cursor || undefined,
  };
}

export type NormalizedAnalyticsFilters = ReturnType<typeof normalizeAnalyticsFilters>;

export function normalizeAnalyticsFilters(filters: AnalyticsFilters) {
  return {
    days: filters.days,
    accountId: filters.accountId?.trim() ?? "",
    source: filters.source ?? "all",
    sort: filters.sort ?? "engagement",
    limit: filters.limit ?? 50,
  } as const;
}
