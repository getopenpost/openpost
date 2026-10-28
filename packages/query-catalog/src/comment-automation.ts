import type { components } from "@openpost/api-contract";
import { inboxQueryKeys } from "./inbox";
import { openPostQueryPolicy, liveQueryStaleTime } from "./policies";
export type CommentAutomationReply = components["schemas"]["AutomationReply"];
export interface CommentAutomationQueryAPI {
  list(workspaceID: string, itemID: string, signal: AbortSignal): Promise<CommentAutomationReply[]>;
}
export function commentAutomationQueryOptions(
  api: CommentAutomationQueryAPI,
  workspaceID: string,
  itemID: string,
) {
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey: [...inboxQueryKeys.engagementRoot(workspaceID), "automation", itemID] as const,
    enabled: Boolean(workspaceID && itemID),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.list(workspaceID, itemID, signal),
  };
}
