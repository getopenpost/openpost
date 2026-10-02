import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, stableQueryStaleTime } from "./policies";

export const editorPreferencesQueryKeys = {
  workspace: (workspaceId: string) => openPostWorkspaceKey(workspaceId, "editor-preferences"),
  context: (workspaceId: string, projectId: string, kind: string, context: string) =>
    openPostWorkspaceKey(workspaceId, "editor-preferences", projectId, kind, context),
};
export function editorPreferencesQueryOptions<T>(
  api: { getPreferences: (signal: AbortSignal) => Promise<T> },
  workspaceId: string,
  projectId: string,
  kind: string,
  context = "",
) {
  const queryKey = editorPreferencesQueryKeys.context(workspaceId, projectId, kind, context);
  return {
    ...openPostQueryPolicy(stableQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) => api.getPreferences(signal),
  };
}
