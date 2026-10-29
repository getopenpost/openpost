import type { components } from "@openpost/api-contract";
import type { InfiniteData, QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type AnalyticsOverview = components["schemas"]["Overview"];
export type AnalyticsRangeDays = 0 | 7 | 30 | 90 | 365;
export type AnalyticsSort = "engagement" | "views" | "visibility" | "newest";

export type AnalyticsCalendarPreset = "month_to_date" | "last_month";

// Custom analytics bounds are inclusive UTC dates on every client.
export function analyticsCalendarPresetRange(
  preset: AnalyticsCalendarPreset,
  now: Date = new Date(),
): { days: 0; from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const from = new Date(Date.UTC(year, month - (preset === "last_month" ? 1 : 0), 1));
  const to = preset === "last_month" ? new Date(Date.UTC(year, month, 0)) : now;
  return { days: 0, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export interface AnalyticsFilters {
  readonly days: AnalyticsRangeDays;
  readonly from?: string;
  readonly to?: string;
  readonly accountId?: string;
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
    placeholderData: (
      previous: InfiniteData<AnalyticsOverview, string> | undefined,
      previousQuery: { queryKey: typeof queryKey } | undefined,
    ) => (previousQuery?.queryKey[3] === workspaceId ? previous : undefined),
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.getAnalyticsOverview(workspaceId, normalized, pageParam, signal),
    getNextPageParam: (lastPage: AnalyticsOverview) => lastPage.content_next_cursor || undefined,
  };
}

export type NormalizedAnalyticsFilters = ReturnType<typeof normalizeAnalyticsFilters> & {
  readonly from?: string;
  readonly to?: string;
};

export function normalizeAnalyticsFilters(filters: AnalyticsFilters) {
  return {
    days: filters.days,
    ...(filters.from || filters.to ? { from: filters.from ?? "", to: filters.to ?? "" } : {}),
    accountId: filters.accountId?.trim() ?? "",
    sort: filters.sort ?? "engagement",
    limit: filters.limit ?? 50,
  } as const;
}
