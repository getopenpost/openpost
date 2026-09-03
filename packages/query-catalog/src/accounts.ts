import type { paths } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, stableQueryStaleTime } from "./policies";

export type AccountProvider = NonNullable<
  paths["/accounts/providers"]["get"]["responses"][200]["content"]["application/json"]
>[number];
export interface AccountCatalogQueryAPI {
  listAccountProviders(workspaceId: string, signal: AbortSignal): Promise<AccountProvider[]>;
}

export const accountCatalogQueryKeys = {
  providers: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "account-providers"),
};

export function isAccountProvidersQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === "openpost" &&
    queryKey[1] === "v1" &&
    queryKey[2] === "workspace" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "account-providers"
  );
}

export function accountProvidersQueryOptions(
  api: Pick<AccountCatalogQueryAPI, "listAccountProviders">,
  workspaceId: string,
) {
  const queryKey = accountCatalogQueryKeys.providers(workspaceId);
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listAccountProviders(workspaceId, signal),
  };
}
