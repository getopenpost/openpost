import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type APIToken = components["schemas"]["APITokenResponse"];
export type MCPActivity = components["schemas"]["MCPActivityItem"];

export interface DeveloperQueryAPI {
  listAPITokens(signal: AbortSignal): Promise<APIToken[]>;
  listMCPActivity(limit: number, signal: AbortSignal): Promise<MCPActivity[]>;
}

const developerRoot = ["openpost", "v1", "developer"] as const;

export const developerQueryKeys = {
  all: developerRoot,
  apiTokens: () => [...developerRoot, "api-tokens"] as const,
  mcpActivityRoot: () => [...developerRoot, "mcp-activity"] as const,
  mcpActivity: (limit: number) => [...developerQueryKeys.mcpActivityRoot(), { limit }] as const,
};

export function apiTokensQueryOptions(api: Pick<DeveloperQueryAPI, "listAPITokens">) {
  const queryKey = developerQueryKeys.apiTokens();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.listAPITokens(signal),
  };
}

export function mcpActivityQueryOptions(
  api: Pick<DeveloperQueryAPI, "listMCPActivity">,
  limit: number,
) {
  const normalizedLimit = Math.max(1, Math.trunc(limit));
  const queryKey = developerQueryKeys.mcpActivity(normalizedLimit);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.listMCPActivity(normalizedLimit, signal),
  };
}
