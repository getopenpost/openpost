import type { components } from "@openpost/api-contract";
import { openPostWorkspaceKey } from "./keys";
import { openPostQueryPolicy, queryStaleTime } from "./policies";

export type PublicationBuild = components["schemas"]["Build"];
export interface PublicationBuildQueryAPI {
  get(workspaceID: string, id: string, signal: AbortSignal): Promise<PublicationBuild>;
}
export function publicationBuildQueryOptions(
  api: PublicationBuildQueryAPI,
  workspaceID: string,
  id: string,
) {
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey: openPostWorkspaceKey(workspaceID, "publication-builds", "detail", id),
    enabled: Boolean(workspaceID && id),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get(workspaceID, id, signal),
  };
}
