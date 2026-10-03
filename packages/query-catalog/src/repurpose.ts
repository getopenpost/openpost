import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type RepurposeSuggestions = components["schemas"]["ClipSuggestions"];

export const repurposeQueryKeys = {
  detail: (workspaceId: string, actorId: string, suggestionId: string) =>
    openPostWorkspaceKey(workspaceId, "repurpose-suggestions", actorId, suggestionId),
};

export function repurposeSuggestionsQueryOptions(
  api: {
    getSuggestions: (id: string, signal: AbortSignal) => Promise<RepurposeSuggestions>;
  },
  workspaceId: string,
  actorId: string,
  suggestionId: string,
) {
  const queryKey = repurposeQueryKeys.detail(workspaceId, actorId, suggestionId);
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId && actorId && suggestionId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getSuggestions(suggestionId, signal),
  };
}
