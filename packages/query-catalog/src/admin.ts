import type { components, paths } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime, stableQueryStaleTime } from "./policies";

export type InstanceOverview = components["schemas"]["InstanceOverviewResponse"];
export type InstanceUserPage = components["schemas"]["InstanceUserPage"];
export type AIPrompts = components["schemas"]["AIPromptsResponse"];
export type InstanceSettings = components["schemas"]["InstanceSettingsResponse"];
export type ProviderApp = components["schemas"]["ProviderAppResponse"];
export type UpdateStatus = components["schemas"]["UpdateStatusResponse"];
export type AdminUsersQuery = NonNullable<paths["/admin/users"]["get"]["parameters"]["query"]>;

export interface InstanceUsersFilters {
  readonly page: number;
  readonly perPage: number;
  readonly search?: string;
  readonly sort: string;
  readonly direction: "asc" | "desc";
}

export interface AdminQueryAPI {
  getInstanceOverview(signal: AbortSignal): Promise<InstanceOverview>;
  listInstanceUsers(
    filters: NormalizedInstanceUsersFilters,
    signal: AbortSignal,
  ): Promise<InstanceUserPage>;
  getAIPrompts(signal: AbortSignal): Promise<AIPrompts>;
  getInstanceSettings(signal: AbortSignal): Promise<InstanceSettings>;
  listProviderApps(signal: AbortSignal): Promise<ProviderApp[]>;
  getUpdateStatus(signal: AbortSignal): Promise<UpdateStatus>;
}

const adminRoot = ["openpost", "v1", "admin"] as const;

export const adminQueryKeys = {
  all: adminRoot,
  overview: () => [...adminRoot, "overview"] as const,
  usersRoot: () => [...adminRoot, "users"] as const,
  users: (filters: InstanceUsersFilters) =>
    [...adminRoot, "users", normalizeInstanceUsersFilters(filters)] as const,
  aiPrompts: () => [...adminRoot, "ai-prompts"] as const,
  instanceSettings: () => [...adminRoot, "instance-settings"] as const,
  providerApps: () => [...adminRoot, "provider-apps"] as const,
  updateStatus: () => [...adminRoot, "update-status"] as const,
};

export function instanceOverviewQueryOptions(api: Pick<AdminQueryAPI, "getInstanceOverview">) {
  const queryKey = adminQueryKeys.overview();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getInstanceOverview(signal),
  };
}

export function instanceUsersQueryOptions(
  api: Pick<AdminQueryAPI, "listInstanceUsers">,
  filters: InstanceUsersFilters,
) {
  const normalized = normalizeInstanceUsersFilters(filters);
  const queryKey = adminQueryKeys.users(normalized);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    placeholderData: (previous: InstanceUserPage | undefined) => previous,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listInstanceUsers(normalized, signal),
  };
}

export function aiPromptsQueryOptions(api: Pick<AdminQueryAPI, "getAIPrompts">) {
  const queryKey = adminQueryKeys.aiPrompts();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getAIPrompts(signal),
  };
}

export function instanceSettingsQueryOptions(api: Pick<AdminQueryAPI, "getInstanceSettings">) {
  const queryKey = adminQueryKeys.instanceSettings();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getInstanceSettings(signal),
  };
}

export function providerAppsQueryOptions(api: Pick<AdminQueryAPI, "listProviderApps">) {
  const queryKey = adminQueryKeys.providerApps();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listProviderApps(signal),
  };
}

export function updateStatusQueryOptions(api: Pick<AdminQueryAPI, "getUpdateStatus">) {
  const queryKey = adminQueryKeys.updateStatus();
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getUpdateStatus(signal),
  };
}

export type NormalizedInstanceUsersFilters = ReturnType<typeof normalizeInstanceUsersFilters>;

export function normalizeInstanceUsersFilters(filters: InstanceUsersFilters) {
  return {
    page: Math.max(1, Math.trunc(filters.page)),
    perPage: Math.max(1, Math.trunc(filters.perPage)),
    search: filters.search?.trim() ?? "",
    sort: filters.sort.trim(),
    direction: filters.direction,
  } as const;
}
