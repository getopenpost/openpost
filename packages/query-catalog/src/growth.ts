import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { liveQueryStaleTime, openPostQueryPolicy } from "./policies";

export type GrowthResult = components["schemas"]["ListResult"];

export interface GrowthQueryAPI {
  getGrowth(workspaceId: string, accountId: string, signal: AbortSignal): Promise<GrowthResult>;
}

export const growthQueryKeys = {
  all: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "growth"),
  account: (workspaceId: string, accountId: string) =>
    openPostWorkspaceKey(workspaceId, "growth", "account", accountId),
};

export function growthQueryOptions(
  api: Pick<GrowthQueryAPI, "getGrowth">,
  workspaceId: string,
  accountId: string,
) {
  const queryKey = growthQueryKeys.account(workspaceId, accountId);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && accountId),
    refetchOnWindowFocus: true,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getGrowth(workspaceId, accountId, signal),
  };
}
