import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type AccountFeatureState = components["schemas"]["FeatureStateResponse"];

export interface FeatureQueryAPI {
  listAccountFeatures(
    workspaceId: string,
    accountIds: readonly string[],
    signal: AbortSignal,
  ): Promise<AccountFeatureState[]>;
}

export const featureQueryKeys = {
  all: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "account-features"),
  accountStates: (workspaceId: string, accountIds: readonly string[]) =>
    [...featureQueryKeys.all(workspaceId), normalizeAccountIds(accountIds)] as const,
};

export function isAccountFeaturesQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === "openpost" &&
    queryKey[1] === "v1" &&
    queryKey[2] === "workspace" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "account-features"
  );
}

export function accountFeaturesQueryOptions(
  api: Pick<FeatureQueryAPI, "listAccountFeatures">,
  workspaceId: string,
  accountIds: readonly string[],
) {
  const normalizedAccountIds = normalizeAccountIds(accountIds);
  const queryKey = featureQueryKeys.accountStates(workspaceId, normalizedAccountIds);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && normalizedAccountIds.length > 0),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listAccountFeatures(workspaceId, normalizedAccountIds, signal),
  };
}

export function normalizeAccountIds(accountIds: readonly string[]) {
  return [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))].sort();
}
