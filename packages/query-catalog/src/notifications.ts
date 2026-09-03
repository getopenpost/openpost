import type { components } from "@openpost/api-contract";
import type { QueryFunctionContext } from "@tanstack/query-core";
import { openPostQueryKeys, openPostWorkspaceKey } from "./keys";
import { liveQueryStaleTime, openPostQueryPolicy, queryStaleTime } from "./policies";

export type NotificationPage = components["schemas"]["NotificationPage"];
export type NotificationPreferences = components["schemas"]["PreferenceSettings"];

export interface NotificationQueryAPI {
  listNotifications(
    workspaceId: string,
    limit: number,
    cursor: string,
    signal: AbortSignal,
  ): Promise<NotificationPage>;
  getNotificationPreferences(signal: AbortSignal): Promise<NotificationPreferences>;
}

export const notificationQueryKeys = {
  inbox: (workspaceId: string, limit: number) =>
    openPostWorkspaceKey(workspaceId, "notifications", "inbox", { limit }),
  preferences: () => [...openPostQueryKeys.all, "account", "notifications", "preferences"] as const,
};

export type NotificationInboxQueryKey = ReturnType<typeof notificationQueryKeys.inbox>;

export function isNotificationInboxQueryKey(
  queryKey: readonly unknown[],
): queryKey is NotificationInboxQueryKey {
  return (
    queryKey[0] === openPostQueryKeys.all[0] &&
    queryKey[1] === openPostQueryKeys.all[1] &&
    queryKey[2] === "workspace" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "notifications" &&
    queryKey[5] === "inbox"
  );
}

export function notificationInboxQueryOptions(
  api: Pick<NotificationQueryAPI, "listNotifications">,
  workspaceId: string,
  limit = 30,
) {
  const queryKey = notificationQueryKeys.inbox(workspaceId, limit);
  return {
    ...openPostQueryPolicy(liveQueryStaleTime),
    queryKey,
    enabled: Boolean(workspaceId),
    initialPageParam: "",
    refetchOnWindowFocus: true,
    queryFn: ({ pageParam, signal }: QueryFunctionContext<typeof queryKey, string>) =>
      api.listNotifications(workspaceId, limit, pageParam, signal),
    getNextPageParam: (lastPage: NotificationPage) => lastPage.next_cursor || undefined,
  };
}

export function notificationPreferencesQueryOptions(
  api: Pick<NotificationQueryAPI, "getNotificationPreferences">,
) {
  const queryKey = notificationQueryKeys.preferences();
  return {
    ...openPostQueryPolicy(queryStaleTime),
    queryKey,
    queryFn: ({ signal }: QueryFunctionContext<typeof queryKey>) =>
      api.getNotificationPreferences(signal),
  };
}
