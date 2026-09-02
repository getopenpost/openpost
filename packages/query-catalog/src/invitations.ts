import { adminQueryKeys } from "./admin";
import { authQueryKeys } from "./auth";
import { openPostBootstrapQueryKeys } from "./bootstrap";
import type { QueryCachePlan } from "./cache-plan";
import { developerQueryKeys } from "./developer";
import { openPostWorkspaceKey } from "./keys";
import { isOrganizationDetailQueryKey, organizationQueryKeys } from "./organizations";
import { publicProfileQueryKeys } from "./public-profiles";
import { workspaceSettingsQueryKeys } from "./workspace-settings";

function acceptedWorkspaceCachePlan(workspaceId: string): QueryCachePlan {
  return {
    remove: [{ queryKey: publicProfileQueryKeys.all() }],
    invalidate: [
      { queryKey: adminQueryKeys.usersRoot() },
      { queryKey: developerQueryKeys.mcpActivityRoot() },
      { queryKey: organizationQueryKeys.all(), exact: true },
      { queryKey: authQueryKeys.linkableOIDCProviders(), exact: true },
      { queryKey: authQueryKeys.security(), exact: true },
      { queryKey: workspaceSettingsQueryKeys.team(workspaceId), exact: true },
      { queryKey: workspaceSettingsQueryKeys.setup(workspaceId), exact: true },
      { queryKey: openPostWorkspaceKey(workspaceId, "access-audit") },
      { queryKey: organizationQueryKeys.instanceAuditRoot() },
    ],
  };
}

export function workspaceInvitationAcceptanceCachePlan(workspaceId: string): QueryCachePlan {
  const plan = acceptedWorkspaceCachePlan(workspaceId);
  return {
    ...plan,
    invalidate: [
      { queryKey: openPostBootstrapQueryKeys.appRoot() },
      { queryKey: openPostBootstrapQueryKeys.workspaces(), exact: true },
      ...plan.invalidate,
      { predicate: (query) => isOrganizationDetailQueryKey(query.queryKey) },
    ],
  };
}

export function workspaceInvitationRefreshCachePlan(
  workspaceId: string,
  organizationId: string,
): QueryCachePlan {
  const plan = acceptedWorkspaceCachePlan(workspaceId);
  return organizationId
    ? {
        ...plan,
        invalidate: [
          ...plan.invalidate,
          { queryKey: organizationQueryKeys.team(organizationId), exact: true },
          { queryKey: organizationQueryKeys.auditRoot(organizationId) },
        ],
      }
    : plan;
}
