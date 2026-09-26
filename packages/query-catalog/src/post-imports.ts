import type { paths } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime } from "./policies";
import { openPostWorkspaceKey } from "./keys";

export type PostImportOverview =
  paths["/accounts/{account_id}/post-imports"]["get"]["responses"][200]["content"]["application/json"];

export interface PostImportQueryAPI {
  readPostImports(
    workspaceID: string,
    accountID: string,
    signal: AbortSignal,
    cursor?: string,
  ): Promise<PostImportOverview>;
}

export const postImportQueryKey = (workspaceID: string, accountID: string) =>
  openPostWorkspaceKey(workspaceID, "accounts", accountID, "post-imports");

export function postImportPageQueryOptions(
  api: PostImportQueryAPI,
  workspaceID: string,
  accountID: string,
  cursor: string,
) {
  const queryKey = [...postImportQueryKey(workspaceID, accountID), "page", cursor] as const;
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.readPostImports(workspaceID, accountID, signal, cursor),
  };
}

export function postImportQueryOptions(
  api: PostImportQueryAPI,
  workspaceID: string,
  accountID: string,
) {
  const queryKey = postImportQueryKey(workspaceID, accountID);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceID && accountID),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.readPostImports(workspaceID, accountID, signal),
  };
}
