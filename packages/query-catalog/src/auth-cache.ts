import { adminQueryKeys } from "./admin";
import { authQueryKeys } from "./auth";
import type { QueryCachePlan } from "./cache-plan";
import { organizationQueryKeys } from "./organizations";
import { workspaceSettingsQueryKeys } from "./workspace-settings";

export function passwordChangeCachePlan(): QueryCachePlan {
  return {
    invalidate: [
      { queryKey: authQueryKeys.security(), exact: true },
      { queryKey: authQueryKeys.sessions(), exact: true },
    ],
  };
}

export interface EmailChangeCacheScope {
  readonly workspaceIds: readonly string[];
  readonly organizationIds: readonly string[];
}

export function emailChangeCachePlan(scope: EmailChangeCacheScope): QueryCachePlan {
  const workspaceIds = [...new Set(scope.workspaceIds.filter(Boolean))];
  const organizationIds = [...new Set(scope.organizationIds.filter(Boolean))];
  return {
    invalidate: [
      { queryKey: authQueryKeys.sessions(), exact: true },
      { queryKey: adminQueryKeys.usersRoot() },
      { queryKey: adminQueryKeys.aiPrompts(), exact: true },
      ...workspaceIds.map((workspaceId) => ({
        queryKey: workspaceSettingsQueryKeys.team(workspaceId),
        exact: true as const,
      })),
      ...organizationIds.map((organizationId) => ({
        queryKey: organizationQueryKeys.team(organizationId),
        exact: true as const,
      })),
      ...organizationIds.map((organizationId) => ({
        queryKey: organizationQueryKeys.ownershipTransfer(organizationId),
        exact: true as const,
      })),
    ],
  };
}
